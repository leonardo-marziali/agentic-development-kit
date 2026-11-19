package demo;

import lombok.Builder;
import lombok.Value;

// Before records, a @Value @Builder class is the immutable read DTO.
class Java11 {

    @Value
    @Builder
    static class ProjectReadDto {
        String name;
    }

}
