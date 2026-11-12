package demo;

import static org.mockito.Mockito.mock;

class GoodTest {

    void shouldMockCollaboratorsWhenNeeded() {
        ProjectRepository repository = mock(ProjectRepository.class);
    }

    interface ProjectRepository {
    }

}
