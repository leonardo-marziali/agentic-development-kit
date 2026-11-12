package org.springframework.stereotype;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

// A stand-in for Spring's annotation, so the fixture compiles without Spring.
@Retention(RetentionPolicy.RUNTIME)
public @interface Component {
}
