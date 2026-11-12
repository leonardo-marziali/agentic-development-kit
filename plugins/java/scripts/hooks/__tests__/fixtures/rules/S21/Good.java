package demo;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper
abstract class Good {

    @Mapping(target = "statusLabel", source = "status")
    protected abstract Object mapToReadDto(Object project);

    protected String toStatusLabel(Object status) {
        return String.valueOf(status);
    }

    private static String helper() {
        return "";
    }

}
