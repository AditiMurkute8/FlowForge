package com.flowforge.execution.state;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.*;

class TaskStateMachineTest {

    private TaskStateMachine stateMachine;

    @BeforeEach
    void setUp() {
        stateMachine = new TaskStateMachine();
    }

    @ParameterizedTest(name = "Valid transition: {0} -> {1}")
    @CsvSource({
            "PENDING, READY",
            "PENDING, CANCELLED",
            "READY, RUNNING",
            "READY, CANCELLED",
            "RUNNING, SUCCESS",
            "RUNNING, FAILED",
            "RUNNING, CANCELLED",
            "FAILED, RETRYING",
            "FAILED, DEAD_LETTER",
            "RETRYING, RUNNING"
    })
    void testValidTransitions(TaskState current, TaskState requested) {
        assertThat(stateMachine.isValidTransition(current, requested)).isTrue();
        TaskState result = stateMachine.transition(current, requested);
        assertThat(result).isEqualTo(requested);
    }

    @ParameterizedTest(name = "Invalid transition: {0} -> {1}")
    @CsvSource({
            "SUCCESS, RUNNING",
            "SUCCESS, FAILED",
            "SUCCESS, RETRYING",
            "SUCCESS, PENDING",
            "PENDING, SUCCESS",
            "PENDING, RUNNING",
            "READY, SUCCESS",
            "DEAD_LETTER, RUNNING",
            "DEAD_LETTER, RETRYING",
            "CANCELLED, RUNNING",
            "CANCELLED, READY",
            "RETRYING, SUCCESS",
            "RETRYING, FAILED"
    })
    void testInvalidTransitions(TaskState current, TaskState requested) {
        assertThat(stateMachine.isValidTransition(current, requested)).isFalse();
        assertThatThrownBy(() -> stateMachine.transition(current, requested))
                .isInstanceOf(InvalidTaskStateTransitionException.class)
                .hasMessage("Invalid task state transition: " + current + " -> " + requested)
                .extracting(e -> (InvalidTaskStateTransitionException) e)
                .satisfies(ex -> {
                    assertThat(ex.getCurrentState()).isEqualTo(current);
                    assertThat(ex.getRequestedState()).isEqualTo(requested);
                });
    }

    @Test
    @DisplayName("Null state inputs should throw IllegalArgumentException")
    void testNullInputs() {
        assertThatThrownBy(() -> stateMachine.transition(null, TaskState.READY))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must not be null");

        assertThatThrownBy(() -> stateMachine.transition(TaskState.PENDING, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must not be null");

        assertThatThrownBy(() -> stateMachine.transition(null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must not be null");

        assertThat(stateMachine.isValidTransition(null, TaskState.READY)).isFalse();
        assertThat(stateMachine.isValidTransition(TaskState.PENDING, null)).isFalse();
        assertThat(stateMachine.isValidTransition(null, null)).isFalse();
    }

    @Test
    @DisplayName("Terminal states (SUCCESS, DEAD_LETTER, CANCELLED) have no valid next states")
    void testTerminalStatesHaveNoNextStates() {
        assertThat(stateMachine.getValidNextStates(TaskState.SUCCESS)).isEmpty();
        assertThat(stateMachine.getValidNextStates(TaskState.DEAD_LETTER)).isEmpty();
        assertThat(stateMachine.getValidNextStates(TaskState.CANCELLED)).isEmpty();
    }
}
