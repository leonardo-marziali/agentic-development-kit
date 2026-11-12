package demo;

import org.mapstruct.Mapper;

@Mapper
interface Bad { // expect: S22
    Object toDomain(Object entity);
}
