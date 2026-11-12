package demo;

import lombok.Builder;
import lombok.Data;
import lombok.Value;

class Good {

    @Value
    @Builder
    static class ProjectReadDto {
        String name;
    }

    @Data
    static class ProjectWriteDto {
        private String name;
    }

}
