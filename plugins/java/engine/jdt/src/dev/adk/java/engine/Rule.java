package dev.adk.java.engine;

import java.util.List;

/**
 * One rule of the standard, identified by its ID. {@link #minJava()} and
 * {@link #minBoot()} keep a rule from recommending what the module can't use:
 * a rule is skipped below that Java level, or below that Spring Boot version
 * ({@code major * 100 + minor}; a module without Spring Boot skips every rule
 * that sets one).
 */
public interface Rule {

    String id();

    default int minJava() {
        return 0;
    }

    default int minBoot() {
        return 0;
    }

    List<Finding> check(SourceFile file);

}
