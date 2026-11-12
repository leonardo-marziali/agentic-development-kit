package demo;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class GoodTest {

    @Test
    void shouldSaveWhenProjectIsNew() {
        assertThat(1).isEqualTo(1);
    }

}
