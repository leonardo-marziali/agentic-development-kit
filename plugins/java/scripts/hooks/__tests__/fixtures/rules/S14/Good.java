package demo;

import lombok.Builder;
import lombok.Data;

class Good {

    @Builder
    record ProjectReadDto(String name) {
    }

    @Data
    static class ProjectWriteDto {
        private String name;
    }

}
