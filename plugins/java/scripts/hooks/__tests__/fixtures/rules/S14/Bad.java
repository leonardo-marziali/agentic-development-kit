package demo;

import lombok.Data;

class Bad {

    @Data
    static class ProjectReadDto { // expect: S14
        private String name;
    }

}
