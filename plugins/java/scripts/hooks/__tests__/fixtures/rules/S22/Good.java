package demo;

import org.mapstruct.Mapper;

@Mapper
abstract class Good {
    protected abstract Object mapToDomain(Object entity);
}
