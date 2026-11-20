package demo;

import lombok.Data;
import lombok.Value;

class Bad {

    @Data
    static class ProjectReadDto { // expect: S14
        private String name;
    }

    @Value
    static class TaskReadDto { // expect: S14
        String name;
    }

}
