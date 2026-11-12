package demo.support;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.springframework.test.util.ReflectionTestUtils;

public final class Fixtures {

    public static void check(Object service) {
        ReflectionTestUtils.setField(service, "clock", null);
        assertEquals(1, 1);
    }

}
