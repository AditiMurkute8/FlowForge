package com.flowforge.api;

import com.flowforge.api.dto.*;
import com.flowforge.config.SchedulerProperties;
import com.flowforge.core.TaskGraph;
import com.flowforge.scheduler.TaskAction;
import com.flowforge.scheduler.TaskRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
            while (actionRelease.getCount() > 0) {
                try {
                    actionRelease.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) {
                }
            }
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

            // 1. Submit workflow 1 with 500ms timeout
            Future<ResponseEntity<?>> future1 = testExecutor.submit(() ->
                singleService.executeWorkflow(request1, 500, TimeUnit.MILLISECONDS, permitReleasedSignal::countDown)
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

    @Test
    @DisplayName("7. Queued dispatch cancellation releases permit without leak or double release")
    void queuedDispatchCancellationReleasesPermitWithoutLeakOrDoubleRelease() throws Exception {
        CountDownLatch task1Started = new CountDownLatch(1);
        CountDownLatch unblockTask1 = new CountDownLatch(1);

        TaskAction blockingAction = id -> {
            task1Started.countDown();
            try {
                unblockTask1.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };

        TaskActionResolver blockingResolver = new TaskActionResolver() {
            @Override
            public TaskAction resolveAction(TaskActionDto actionDto) {
                return blockingAction;
            }
        };

        WorkflowExecutionService singleService = new WorkflowExecutionService(properties, blockingResolver);

        try {
            ExecuteWorkflowRequest request1 = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("t1", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );

            // Submit request 1, which occupies the single dispatcher thread
            Future<ResponseEntity<?>> future1 = testExecutor.submit(() ->
                singleService.executeWorkflow(request1, 10, TimeUnit.SECONDS, null)
            );

            assertThat(task1Started.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(singleService.getSemaphore().availablePermits()).isEqualTo(0);

            // Simulate second request with acquired permit queued behind request 1
            singleService.getSemaphore().release();
            boolean acquired2 = singleService.getSemaphore().tryAcquire();
            assertThat(acquired2).isTrue();

            CountDownLatch permit2Released = new CountDownLatch(1);
            TaskGraph graph = singleService.buildTaskGraph(List.of(new TaskDefinitionDto("t2", null, null)), List.of());
            TaskRegistry registry = taskActionResolver.resolveRegistry(List.of(new TaskDefinitionDto("t2", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)));

            // Dispatch task 2 with short timeout of 50ms while dispatcher thread is busy
            assertThatThrownBy(() ->
                singleService.executeGraphUnderPermit(
                    graph,
                    registry,
                    1,
                    50,
                    TimeUnit.MILLISECONDS,
                    null,
                    permit2Released::countDown
                )
            ).isInstanceOf(TimeoutException.class);

            // Prove permit was released promptly on timeout even though it was queued in dispatcher
            assertThat(permit2Released.await(2, TimeUnit.SECONDS))
                .as("Permit for queued task must be released on timeout without leak")
                .isTrue();
            // Request 2's permit was released while request 1 is still running
            assertThat(singleService.getSemaphore().availablePermits()).isEqualTo(1);

            // Unblock request 1
            unblockTask1.countDown();
            ResponseEntity<?> response1 = future1.get(5, TimeUnit.SECONDS);
            assertThat(response1.getStatusCode()).isEqualTo(HttpStatus.OK);

            // Give a moment for dispatcher thread to poll the cancelled queue task
            Thread.sleep(100);

            // Total available permits must be exactly 2 (both permits returned, no double release and no leak)
            assertThat(singleService.getSemaphore().availablePermits()).isEqualTo(2);
        } finally {
            unblockTask1.countDown();
            singleService.shutdown();
        }
    }

    @Test
    @DisplayName("8. Eventual reclamation safely reclaims permit after delayed worker terminates")
    void delayedWorkerTerminationReclaimsPermitAfterEventualTermination() throws Exception {
        CountDownLatch actionStarted = new CountDownLatch(1);
        CountDownLatch permitReleasedSignal = new CountDownLatch(1);
        AtomicBoolean keepRunning = new AtomicBoolean(true);

        // Action that runs for 400ms ignoring interrupts
        TaskAction slowAction = id -> {
            actionStarted.countDown();
            long deadline = System.currentTimeMillis() + 400;
            while (System.currentTimeMillis() < deadline && keepRunning.get()) {
                try {
                    Thread.sleep(50);
                } catch (InterruptedException ignored) {}
            }
        };

        TaskActionResolver slowResolver = new TaskActionResolver() {
            @Override
            public TaskAction resolveAction(TaskActionDto actionDto) {
                return slowAction;
            }
        };

        // Service subclass overriding closeScheduler to wait only 100ms
        WorkflowExecutionService fastCloseService = new WorkflowExecutionService(properties, slowResolver) {
            @Override
            void closeScheduler(com.flowforge.scheduler.WorkflowScheduler scheduler) {
                if (scheduler != null) {
                    scheduler.close(100, TimeUnit.MILLISECONDS);
                }
            }
        };

        try {
            ExecuteWorkflowRequest request = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("delayed-task", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );

            // Submit with 100ms timeout
            Future<ResponseEntity<?>> future = testExecutor.submit(() ->
                fastCloseService.executeWorkflow(request, 100, TimeUnit.MILLISECONDS, permitReleasedSignal::countDown)
            );

            assertThat(actionStarted.await(5, TimeUnit.SECONDS)).isTrue();

            ResponseEntity<?> response = future.get(5, TimeUnit.SECONDS);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);

            // At 150ms, worker is still running (400ms duration), so permit must NOT be released yet
            assertThat(permitReleasedSignal.getCount()).isEqualTo(1);
            assertThat(fastCloseService.getSemaphore().availablePermits()).isEqualTo(0);

            // Wait for worker to finish (at ~400ms) and reaper thread to reclaim permit
            boolean reclaimed = permitReleasedSignal.await(3, TimeUnit.SECONDS);
            assertThat(reclaimed).as("Permit must be reclaimed after delayed worker terminates").isTrue();
            assertThat(fastCloseService.getSemaphore().availablePermits()).isEqualTo(1);
        } finally {
            keepRunning.set(false);
            fastCloseService.shutdown();
        }
    }

    @Test
    @DisplayName("9. Multi-step reaper loop: worker outlives initial reaper step and terminates; permit is eventually reclaimed")
    void workerOutlivesInitialReaperStepAndIsReclaimed() throws Exception {
        CountDownLatch actionStarted = new CountDownLatch(1);
        CountDownLatch allowTermination = new CountDownLatch(1);
        CountDownLatch permitReleasedSignal = new CountDownLatch(1);

        TaskAction slowAction = id -> {
            actionStarted.countDown();
            while (allowTermination.getCount() > 0) {
                try {
                    allowTermination.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) {}
            }
        };

        TaskActionResolver resolver = new TaskActionResolver() {
            @Override
            public TaskAction resolveAction(TaskActionDto actionDto) {
                return slowAction;
            }
        };

        WorkflowExecutionService fastStepService = new WorkflowExecutionService(properties, resolver) {
            @Override
            void closeScheduler(com.flowforge.scheduler.WorkflowScheduler scheduler) {
                if (scheduler != null) {
                    scheduler.close(50, TimeUnit.MILLISECONDS);
                }
            }
        };
        // Configure short reaper step (50ms) to force multiple loop iterations while worker is alive
        fastStepService.setReaperStepTimeoutMs(50L);

        try {
            ExecuteWorkflowRequest request = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("multi-step-task", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );

            Future<ResponseEntity<?>> future = testExecutor.submit(() ->
                fastStepService.executeWorkflow(request, 100, TimeUnit.MILLISECONDS, permitReleasedSignal::countDown)
            );

            assertThat(actionStarted.await(5, TimeUnit.SECONDS)).isTrue();
            ResponseEntity<?> response = future.get(5, TimeUnit.SECONDS);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);

            // Wait 150ms: multiple reaper cycles (at 50ms each) elapse without worker terminating
            Thread.sleep(150);

            // Permit must NOT be released while worker is still alive
            assertThat(permitReleasedSignal.getCount()).isEqualTo(1);
            assertThat(fastStepService.getSemaphore().availablePermits()).isEqualTo(0);

            // Now allow worker to terminate
            allowTermination.countDown();

            // Next reaper cycle detects termination and reclaims permit
            assertThat(permitReleasedSignal.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(fastStepService.getSemaphore().availablePermits()).isEqualTo(1);
        } finally {
            allowTermination.countDown();
            fastStepService.shutdown();
        }
    }

    @Test
    @DisplayName("10. Reaper transient interruption does not abandon permit; permit is reclaimed upon worker termination")
    void reaperInterruptionDoesNotAbandonPermit() throws Exception {
        CountDownLatch actionStarted = new CountDownLatch(1);
        CountDownLatch allowTermination = new CountDownLatch(1);
        CountDownLatch permitReleasedSignal = new CountDownLatch(1);
        CountDownLatch reaperWaiting = new CountDownLatch(1);

        TaskAction slowAction = id -> {
            actionStarted.countDown();
            while (allowTermination.getCount() > 0) {
                try {
                    allowTermination.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) {}
            }
        };

        TaskActionResolver resolver = new TaskActionResolver() {
            @Override
            public TaskAction resolveAction(TaskActionDto actionDto) {
                return slowAction;
            }
        };

        AtomicReference<Thread> capturedReaperThread = new AtomicReference<>();

        WorkflowExecutionService serviceWithInterruptibleReaper = new WorkflowExecutionService(properties, resolver) {
            @Override
            void closeScheduler(com.flowforge.scheduler.WorkflowScheduler scheduler) {
                if (scheduler != null) {
                    scheduler.close(50, TimeUnit.MILLISECONDS);
                }
            }

            @Override
            void runReaperLoop(com.flowforge.scheduler.WorkflowScheduler scheduler, AtomicBoolean permitHandled, Runnable onPermitReleased) {
                capturedReaperThread.set(Thread.currentThread());
                reaperWaiting.countDown();
                super.runReaperLoop(scheduler, permitHandled, onPermitReleased);
            }
        };
        serviceWithInterruptibleReaper.setReaperStepTimeoutMs(100L);

        try {
            ExecuteWorkflowRequest request = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("interrupt-task", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );

            Future<ResponseEntity<?>> future = testExecutor.submit(() ->
                serviceWithInterruptibleReaper.executeWorkflow(request, 100, TimeUnit.MILLISECONDS, permitReleasedSignal::countDown)
            );

            assertThat(actionStarted.await(5, TimeUnit.SECONDS)).isTrue();
            ResponseEntity<?> response = future.get(5, TimeUnit.SECONDS);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);

            // Wait until reaper is actively executing
            assertThat(reaperWaiting.await(5, TimeUnit.SECONDS)).isTrue();
            Thread reaperThread = capturedReaperThread.get();
            assertThat(reaperThread).isNotNull();

            // Interrupt reaper while worker is still executing
            reaperThread.interrupt();

            // Give a moment for interrupt to be caught and cleared
            Thread.sleep(100);

            // Permit must still NOT be released while worker is running
            assertThat(permitReleasedSignal.getCount()).isEqualTo(1);
            assertThat(serviceWithInterruptibleReaper.getSemaphore().availablePermits()).isEqualTo(0);

            // Allow worker to finish
            allowTermination.countDown();

            // Verify permit is successfully reclaimed despite prior interruption
            assertThat(permitReleasedSignal.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(serviceWithInterruptibleReaper.getSemaphore().availablePermits()).isEqualTo(1);
        } finally {
            allowTermination.countDown();
            serviceWithInterruptibleReaper.shutdown();
        }
    }

    @Test
    @DisplayName("11. Exactly-once permit release despite competing caller and reaper release attempts")
    void exactlyOncePermitReleaseUnderConcurrency() throws Exception {
        AtomicBoolean permitHandled = new AtomicBoolean(false);
        AtomicInteger releaseCallbackCount = new AtomicInteger(0);

        int initialPermits = service.getSemaphore().availablePermits();
        service.getSemaphore().acquire(); // Acquire 1 permit

        int threads = 8;
        ExecutorService concurrentExec = Executors.newFixedThreadPool(threads);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(threads);

        for (int i = 0; i < threads; i++) {
            concurrentExec.submit(() -> {
                try {
                    startLatch.await();
                    service.releasePermitSafely(permitHandled, releaseCallbackCount::incrementAndGet);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    doneLatch.countDown();
                }
            });
        }

        startLatch.countDown();
        assertThat(doneLatch.await(5, TimeUnit.SECONDS)).isTrue();
        concurrentExec.shutdown();

        // Exactly one callback invocation and exactly one permit returned
        assertThat(releaseCallbackCount.get()).isEqualTo(1);
        assertThat(service.getSemaphore().availablePermits()).isEqualTo(initialPermits);
    }

    @Test
    @DisplayName("12. Reaper handles recoverable exception in loop without abandoning permit")
    void reaperRecoversFromTransientException() throws Exception {
        CountDownLatch actionStarted = new CountDownLatch(1);
        CountDownLatch allowTermination = new CountDownLatch(1);
        CountDownLatch permitReleasedSignal = new CountDownLatch(1);

        TaskAction slowAction = id -> {
            actionStarted.countDown();
            while (allowTermination.getCount() > 0) {
                try {
                    allowTermination.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) {}
            }
        };

        TaskActionResolver resolver = new TaskActionResolver() {
            @Override
            public TaskAction resolveAction(TaskActionDto actionDto) {
                return slowAction;
            }
        };

        AtomicBoolean threwOnce = new AtomicBoolean(false);

        WorkflowExecutionService serviceWithFaultyReaper = new WorkflowExecutionService(properties, resolver) {
            @Override
            void closeScheduler(com.flowforge.scheduler.WorkflowScheduler scheduler) {
                if (scheduler != null) {
                    scheduler.close(50, TimeUnit.MILLISECONDS);
                }
            }

            @Override
            boolean isSchedulerTerminated(com.flowforge.scheduler.WorkflowScheduler scheduler) {
                if (!threwOnce.getAndSet(true)) {
                    throw new RuntimeException("Simulated transient reaper error");
                }
                return super.isSchedulerTerminated(scheduler);
            }
        };
        serviceWithFaultyReaper.setReaperStepTimeoutMs(50L);

        try {
            ExecuteWorkflowRequest request = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("fault-task", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );

            Future<ResponseEntity<?>> future = testExecutor.submit(() ->
                serviceWithFaultyReaper.executeWorkflow(request, 100, TimeUnit.MILLISECONDS, permitReleasedSignal::countDown)
            );

            assertThat(actionStarted.await(5, TimeUnit.SECONDS)).isTrue();
            ResponseEntity<?> response = future.get(5, TimeUnit.SECONDS);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);

            // Allow worker to finish
            allowTermination.countDown();

            // Reaper recovers from transient error and reclaims permit
            assertThat(permitReleasedSignal.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(serviceWithFaultyReaper.getSemaphore().availablePermits()).isEqualTo(1);
        } finally {
            allowTermination.countDown();
            serviceWithFaultyReaper.shutdown();
        }
    }

    @Test
    @DisplayName("13. Concurrent reaper loops: multiple quarantined workflows are reaped independently without head-of-line blocking")
    void concurrentQuarantinedWorkflowsReapedIndependentlyWithoutHeadOfLineBlocking() throws Exception {
        SchedulerProperties multiProps = new SchedulerProperties();
        multiProps.setMaxConcurrentWorkflows(2);
        multiProps.setExecutionTimeoutSeconds(15);

        CountDownLatch wf1Started = new CountDownLatch(1);
        CountDownLatch wf2Started = new CountDownLatch(1);
        CountDownLatch allowWf1Termination = new CountDownLatch(1);
        CountDownLatch allowWf2Termination = new CountDownLatch(1);
        CountDownLatch wf1ReaperStarted = new CountDownLatch(1);
        CountDownLatch wf2ReaperStarted = new CountDownLatch(1);
        CountDownLatch wf1PermitReleased = new CountDownLatch(1);
        CountDownLatch wf2PermitReleased = new CountDownLatch(1);

        TaskActionResolver resolver = new TaskActionResolver() {
            @Override
            public TaskAction resolveAction(TaskActionDto actionDto) {
                return id -> {
                    if ("task-1".equals(id)) {
                        wf1Started.countDown();
                        while (allowWf1Termination.getCount() > 0) {
                            try {
                                allowWf1Termination.await(5, TimeUnit.SECONDS);
                            } catch (InterruptedException ignored) {}
                        }
                    } else if ("task-2".equals(id)) {
                        wf2Started.countDown();
                        while (allowWf2Termination.getCount() > 0) {
                            try {
                                allowWf2Termination.await(5, TimeUnit.SECONDS);
                            } catch (InterruptedException ignored) {}
                        }
                    }
                };
            }
        };

        AtomicInteger reaperInvocationCount = new AtomicInteger(0);

        WorkflowExecutionService multiService = new WorkflowExecutionService(multiProps, resolver) {
            @Override
            void closeScheduler(com.flowforge.scheduler.WorkflowScheduler scheduler) {
                if (scheduler != null) {
                    scheduler.close(50, TimeUnit.MILLISECONDS);
                }
            }

            @Override
            void runReaperLoop(com.flowforge.scheduler.WorkflowScheduler scheduler, AtomicBoolean permitHandled, Runnable onPermitReleased) {
                int call = reaperInvocationCount.incrementAndGet();
                if (call == 1) {
                    wf1ReaperStarted.countDown();
                } else {
                    wf2ReaperStarted.countDown();
                }
                super.runReaperLoop(scheduler, permitHandled, onPermitReleased);
            }
        };
        multiService.setReaperStepTimeoutMs(50L);

        try {
            ExecuteWorkflowRequest req1 = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("task-1", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );
            ExecuteWorkflowRequest req2 = new ExecuteWorkflowRequest(
                List.of(new TaskDefinitionDto("task-2", new TaskActionDto(TaskActionType.NO_OP, null, null, null), null)),
                List.of(),
                1
            );

            Future<ResponseEntity<?>> f1 = testExecutor.submit(() ->
                multiService.executeWorkflow(req1, 100, TimeUnit.MILLISECONDS, wf1PermitReleased::countDown)
            );
            Future<ResponseEntity<?>> f2 = testExecutor.submit(() ->
                multiService.executeWorkflow(req2, 100, TimeUnit.MILLISECONDS, wf2PermitReleased::countDown)
            );

            assertThat(wf1Started.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(wf2Started.await(5, TimeUnit.SECONDS)).isTrue();

            assertThat(f1.get(5, TimeUnit.SECONDS).getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
            assertThat(f2.get(5, TimeUnit.SECONDS).getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);

            // 1. Both reapers must be running concurrently on separate threads
            assertThat(wf1ReaperStarted.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(wf2ReaperStarted.await(5, TimeUnit.SECONDS)).isTrue();

            // 2. Both permits remain quarantined while workers are still alive
            assertThat(wf1PermitReleased.getCount()).isEqualTo(1);
            assertThat(wf2PermitReleased.getCount()).isEqualTo(1);
            assertThat(multiService.getSemaphore().availablePermits()).isEqualTo(0);

            // 3. Workflow 2 terminates while Workflow 1 worker remains active
            allowWf2Termination.countDown();

            // Workflow 2 permit is reclaimed independently; Workflow 1 remains quarantined (NO head-of-line blocking!)
            assertThat(wf2PermitReleased.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(multiService.getSemaphore().availablePermits()).isEqualTo(1);
            assertThat(wf1PermitReleased.getCount()).isEqualTo(1);

            // 4. Now allow Workflow 1 to terminate; its permit is reclaimed exactly once
            allowWf1Termination.countDown();
            assertThat(wf1PermitReleased.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(multiService.getSemaphore().availablePermits()).isEqualTo(2);
        } finally {
            allowWf1Termination.countDown();
            allowWf2Termination.countDown();
            multiService.shutdown();
        }
    }

    @Test
    @DisplayName("14. Service shutdown quarantines active worker permit without premature release")
    void shutdownQuarantinesActiveWorkerPermitWithoutPrematureRelease() throws Exception {
        AtomicBoolean permitHandled = new AtomicBoolean(false);
        CountDownLatch permitReleased = new CountDownLatch(1);

        WorkflowExecutionService shutdownService = new WorkflowExecutionService(properties, taskActionResolver) {
            @Override
            boolean isSchedulerTerminated(com.flowforge.scheduler.WorkflowScheduler scheduler) {
                return false; // Worker is still running
            }
        };
        shutdownService.getSemaphore().acquire(); // Take 1 permit
        assertThat(shutdownService.getSemaphore().availablePermits()).isEqualTo(0);

        // Shut down the service
        shutdownService.shutdown();
        assertThat(shutdownService.isShutdown()).isTrue();

        com.flowforge.scheduler.WorkflowScheduler uncompletedScheduler = new com.flowforge.scheduler.WorkflowScheduler(1);

        try {
            // Attempt reclamation after shutdown while worker is still alive
            shutdownService.reclaimPermitWhenTerminated(uncompletedScheduler, permitHandled, permitReleased::countDown);

            // Permit must NOT be released while worker is alive, even during shutdown
            assertThat(permitReleased.getCount()).isEqualTo(1);
            assertThat(permitHandled.get()).isFalse();
            assertThat(shutdownService.getSemaphore().availablePermits()).isEqualTo(0);
        } finally {
            uncompletedScheduler.close();
        }
    }

    @Test
    @DisplayName("15. Normal runtime rejection launches asynchronous fallback reaper and reclaims permit")
    void runtimeRejectionLaunchesFallbackReaperAndReclaimsPermit() throws Exception {
        CountDownLatch allowTermination = new CountDownLatch(1);
        CountDownLatch permitReleasedSignal = new CountDownLatch(1);
        AtomicBoolean permitHandled = new AtomicBoolean(false);

        // Service is active (!isShutdown), but we simulate executor rejection
        WorkflowExecutionService serviceWithRejectedReaper = new WorkflowExecutionService(properties, taskActionResolver) {
            @Override
            boolean isSchedulerTerminated(com.flowforge.scheduler.WorkflowScheduler scheduler) {
                return allowTermination.getCount() == 0;
            }
        };
        serviceWithRejectedReaper.setReaperStepTimeoutMs(50L);
        serviceWithRejectedReaper.getSemaphore().acquire(); // Acquire permit
        assertThat(serviceWithRejectedReaper.getSemaphore().availablePermits()).isEqualTo(0);

        // Intentionally shut down the internal reaper executor only, simulating rejected execution while service is active
        serviceWithRejectedReaper.getPermitReaperExecutor().shutdown();

        com.flowforge.scheduler.WorkflowScheduler scheduler = new com.flowforge.scheduler.WorkflowScheduler(1);

        try {
            // Service is active, so rejection triggers asynchronous fallback daemon thread
            serviceWithRejectedReaper.reclaimPermitWhenTerminated(scheduler, permitHandled, permitReleasedSignal::countDown);

            // Worker is still alive; permit must remain quarantined
            assertThat(permitReleasedSignal.getCount()).isEqualTo(1);
            assertThat(serviceWithRejectedReaper.getSemaphore().availablePermits()).isEqualTo(0);

            // Allow worker to terminate
            allowTermination.countDown();

            // Fallback reaper detects termination and reclaims permit
            assertThat(permitReleasedSignal.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(serviceWithRejectedReaper.getSemaphore().availablePermits()).isEqualTo(1);
        } finally {
            allowTermination.countDown();
            scheduler.close();
            serviceWithRejectedReaper.shutdown();
        }
    }
}
