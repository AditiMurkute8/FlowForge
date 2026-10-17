package com.flowforge.api;

import com.flowforge.api.dto.*;
import com.flowforge.config.SchedulerProperties;
import com.flowforge.scheduler.TaskAction;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;

class WorkflowExecutionServiceTest {

    private SchedulerProperties properties;
    private TaskActionResolver taskActionResolver;
    private WorkflowExecutionService service;
    private ExecutorService testExecutor;

    @BeforeEach
    void setUp() {
        properties = new SchedulerProperties();
        properties.setMaxConcurrentWorkflows(1); // 1 permit to test capacity strictly
        properties.setExecutionTimeoutSeconds(15);
        taskActionResolver = new TaskActionResolver();
        service = new WorkflowExecutionService(properties, taskActionResolver);
        testExecutor = Executors.newCachedThreadPool();
    }

    @AfterEach
    void tearDown() {
        service.shutdown();
        testExecutor.shutdownNow();
    }

    @Test
    @DisplayName("1. Parallel execution proof: independent tasks execute concurrently without artificial sleeps")
    void parallelExecutionProof() throws Exception {
        CountDownLatch enteredBoth = new CountDownLatch(2);
        CountDownLatch releaseBoth = new CountDownLatch(1);

        TaskAction parallelAction = id -> {
            enteredBoth.countDown();
            releaseBoth.await(5, TimeUnit.SECONDS);
        };

        // Custom resolver injecting controlled parallelAction for both tasks
        TaskActionResolver mockResolver = new TaskActionResolver() {
            @Override
            public TaskAction resolveAction(TaskActionDto actionDto) {
                return parallelAction;
            }
        };

        SchedulerProperties multiProp = new SchedulerProperties();
        multiProp.setMaxConcurrentWorkflows(2);
        multiProp.setExecutionTimeoutSeconds(15);
        WorkflowExecutionService multiService = new WorkflowExecutionService(multiProp, mockResolver);

        try {
            ExecuteWorkflowRequest request = new ExecuteWorkflowRequest(
                List.of(
                    new TaskDefinitionDto("A", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null),
                    new TaskDefinitionDto("B", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)
                ),
                List.of(), // Independent
                2 // Concurrency 2
            );

            Future<ResponseEntity<?>> future = testExecutor.submit(() -> multiService.executeWorkflow(request));

            // Assert that BOTH tasks A and B have actively entered execution concurrently
            assertThat(enteredBoth.await(5, TimeUnit.SECONDS))
                .as("Both tasks must enter execution concurrently")
                .isTrue();

            // Release both
            releaseBoth.countDown();

            ResponseEntity<?> response = future.get(5, TimeUnit.SECONDS);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        } finally {
            multiService.shutdown();
        }
    }

    @Test
    @DisplayName("2. Deterministic timeout: returns 504 promptly, holds capacity during lingering action, and releases permit after verified termination")
    void timeoutPreservesCapacityUntilDrained() throws Exception {
        CountDownLatch actionStarted = new CountDownLatch(1);
        CountDownLatch actionRelease = new CountDownLatch(1);
        CountDownLatch permitReleasedSignal = new CountDownLatch(1);

        TaskAction lingeringAction = id -> {
            actionStarted.countDown();
            actionRelease.await(5, TimeUnit.SECONDS);
        };

        TaskActionResolver mockResolver = new TaskActionResolver() {
            @Override
            public TaskAction resolveAction(TaskActionDto actionDto) {
                return lingeringAction;
            }
        };

        WorkflowExecutionService singleService = new WorkflowExecutionService(properties, mockResolver);

        try {
            ExecuteWorkflowRequest request1 = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("slow-task", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );

            // 1. Submit workflow 1 with 100ms timeout
            Future<ResponseEntity<?>> future1 = testExecutor.submit(() ->
                singleService.executeWorkflow(request1, 100, TimeUnit.MILLISECONDS, permitReleasedSignal::countDown)
            );

            // Ensure task has started
            assertThat(actionStarted.await(5, TimeUnit.SECONDS)).isTrue();

            // 2. Request 1 returns 504 Gateway Timeout promptly at 100ms
            ResponseEntity<?> response1 = future1.get(5, TimeUnit.SECONDS);
            assertThat(response1.getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);

            // 3. Request 2 arrives while workflow 1 is still blocked: receives 429 Too Many Requests
            ExecuteWorkflowRequest request2 = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("fast-task", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );
            ResponseEntity<?> response2 = singleService.executeWorkflow(request2, 100, TimeUnit.MILLISECONDS, null);
            assertThat(response2.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

            // 4. Verify that permitReleasedSignal has NOT fired while worker is still blocked
            assertThat(permitReleasedSignal.getCount()).isEqualTo(1);

            // 5. Release lingering action so worker can terminate
            actionRelease.countDown();

            // 6. Verify that permitReleasedSignal fires strictly after verified termination
            assertThat(permitReleasedSignal.await(5, TimeUnit.SECONDS)).isTrue();

            // 7. Request 3 arrives after cleanup: now succeeds with 200 OK
            ResponseEntity<?> response3 = singleService.executeWorkflow(request2, 5, TimeUnit.SECONDS, null);
            assertThat(response3.getStatusCode()).isEqualTo(HttpStatus.OK);
        } finally {
            singleService.shutdown();
        }
    }

    @Test
    @DisplayName("3. Quarantine verification: lingering uncooperative worker prevents permit release")
    void lingeringWorkerCausesPermitQuarantine() throws Exception {
        CountDownLatch actionStarted = new CountDownLatch(1);
        CountDownLatch permitReleasedSignal = new CountDownLatch(1);
        AtomicBoolean keepRunning = new AtomicBoolean(true);

        // Action that ignores interruption and keeps thread alive
        TaskAction uncooperativeAction = id -> {
            actionStarted.countDown();
            while (keepRunning.get()) {
                try {
                    Thread.sleep(50);
                } catch (InterruptedException ignored) {
                    // Deliberately swallows interrupt to simulate rogue action
                }
            }
        };

        TaskActionResolver mockResolver = new TaskActionResolver() {
            @Override
            public TaskAction resolveAction(TaskActionDto actionDto) {
                return uncooperativeAction;
            }
        };

        WorkflowExecutionService singleService = new WorkflowExecutionService(properties, mockResolver);

        try {
            ExecuteWorkflowRequest request = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("rogue-task", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );

            // Submit with short timeout
            Future<ResponseEntity<?>> future = testExecutor.submit(() ->
                singleService.executeWorkflow(request, 100, TimeUnit.MILLISECONDS, permitReleasedSignal::countDown)
            );

            assertThat(actionStarted.await(5, TimeUnit.SECONDS)).isTrue();

            // HTTP thread returns 504 promptly
            ResponseEntity<?> response = future.get(5, TimeUnit.SECONDS);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);

            // Wait brief moment for close() to attempt termination
            // Because uncooperativeAction swallowed interrupt, scheduler.isTerminated() is false!
            // permitReleasedSignal must NOT fire
            boolean released = permitReleasedSignal.await(1, TimeUnit.SECONDS);
            assertThat(released).as("Permit must NOT be released while worker is alive").isFalse();

            // Capacity remains occupied: next request is rejected with 429
            ResponseEntity<?> response2 = singleService.executeWorkflow(
                new ExecuteWorkflowRequest(List.of(new TaskDefinitionDto("task-2", null, null)), List.of(), 1),
                100, TimeUnit.MILLISECONDS, null
            );
            assertThat(response2.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        } finally {
            keepRunning.set(false); // Allow thread to exit
            singleService.shutdown();
        }
    }

    @Test
    @DisplayName("4. Dispatcher rejection releases permit exactly once and returns 503 Service Unavailable")
    void dispatcherRejectionReleasesPermit() {
        // Shut down the service's dispatcher executor to force RejectedExecutionException
        service.shutdown();

        ExecuteWorkflowRequest request = new ExecuteWorkflowRequest(
            List.of(new TaskDefinitionDto("task-1", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
            List.of(),
            1
        );

        ResponseEntity<?> response = service.executeWorkflow(request);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);

        // Verify permit was not leaked: semaphore still has its 1 permit available
        assertThat(service.getSemaphore().availablePermits()).isEqualTo(1);
    }

    @Test
    @DisplayName("5. Quarantine verification: throwing termination check quarantines permit")
    void throwingTerminationCheckQuarantinesPermit() {
        WorkflowExecutionService faultyService = new WorkflowExecutionService(properties, taskActionResolver) {
            @Override
            boolean isSchedulerTerminated(com.flowforge.scheduler.WorkflowScheduler scheduler) {
                throw new RuntimeException("Simulated termination check failure");
            }
        };

        try {
            ExecuteWorkflowRequest request = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("task-1", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );

            ResponseEntity<?> response = faultyService.executeWorkflow(request, 5, TimeUnit.SECONDS, null);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

            // Because termination check threw, permit was quarantined (NOT released back to semaphore)
            assertThat(faultyService.getSemaphore().availablePermits()).isEqualTo(0);

            // Subsequent request rejected with 429 because capacity is quarantined
            ResponseEntity<?> nextResponse = faultyService.executeWorkflow(request, 1, TimeUnit.SECONDS, null);
            assertThat(nextResponse.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        } finally {
            faultyService.shutdown();
        }
    }

    @Test
    @DisplayName("6. Callback safety: throwing onPermitReleased callback does not prevent permit release")
    void throwingPermitReleasedCallbackDoesNotDisruptPermitRelease() throws Exception {
        ExecuteWorkflowRequest request = new ExecuteWorkflowRequest(
            List.of(new TaskDefinitionDto("task-1", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
            List.of(),
            1
        );

        CountDownLatch callbackExecuted = new CountDownLatch(1);

        // Provide a callback that counts down and then throws RuntimeException
        ResponseEntity<?> response = service.executeWorkflow(request, 5, TimeUnit.SECONDS, () -> {
            callbackExecuted.countDown();
            throw new RuntimeException("Simulated callback failure");
        });

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(callbackExecuted.await(5, TimeUnit.SECONDS)).isTrue();

        // Permit must still be released back to semaphore despite callback exception
        assertThat(service.getSemaphore().availablePermits()).isEqualTo(1);
    }
}
