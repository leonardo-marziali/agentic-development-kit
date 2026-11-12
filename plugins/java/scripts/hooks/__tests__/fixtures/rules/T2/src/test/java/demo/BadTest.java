package demo;

import static org.junit.jupiter.api.Assertions.assertEquals; // expect: T2

import org.junit.jupiter.api.Test;

class BadTest {

    @Test
    void testSave() { // expect: T2
        assertEquals(1, 1);
    }

}
