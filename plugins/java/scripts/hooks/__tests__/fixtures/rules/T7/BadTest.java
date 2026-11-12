package demo;

import static org.mockito.Mockito.mock;

import org.springframework.test.util.ReflectionTestUtils;

class BadTest {

    void shouldNotCheatWhenTesting() {
        Object service = new Object();
        ReflectionTestUtils.setField(service, "clock", null); // expect: T7
        ProjectReadDto dto = mock(ProjectReadDto.class); // expect: T7
    }

    static class ProjectReadDto {
    }

}
