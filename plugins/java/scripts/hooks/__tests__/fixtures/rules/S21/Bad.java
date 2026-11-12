package demo;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper
abstract class Bad {

    @Mapping(target = "statusLabel", expression = "java(project.getStatus().name())") // expect: S21
    protected abstract Object mapToReadDto(Object project);

    private String toLabel(Object status) { // expect: S21
        return String.valueOf(status);
    }

}
