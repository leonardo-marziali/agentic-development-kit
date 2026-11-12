package dev.adk.java.engine.rules;

import dev.adk.java.engine.Rule;
import java.util.List;

/** Every source rule the engine runs. */
public final class RuleRegistry {

    private static final List<Rule> ALL = List.of(
        new WildcardImports(),
        new JavadocTags(),
        new JavadocStyle(),
        new BlockComments(),
        new Slf4jLogger(),
        new ConstructorInjection(),
        new ConfigurationProperties(),
        new RestClientOnly(),
        new FormatterMarkers(),
        new TestStyle(),
        new TestShortcuts());

    private RuleRegistry() {
    }

    public static List<Rule> all() {
        return ALL;
    }

}
