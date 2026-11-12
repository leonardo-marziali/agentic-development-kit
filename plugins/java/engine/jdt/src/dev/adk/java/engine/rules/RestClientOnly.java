package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.eclipse.jdt.core.dom.ImportDeclaration;

/*
 * S57: outbound HTTP uses RestClient (Spring Framework 6.1, Spring Boot 3.2),
 * so the rule only applies from Boot 3.2 on.
 */
final class RestClientOnly implements Rule {

    private static final Map<String, String> REPLACED = Map.of(
        "org.springframework.web.client.RestTemplate", "RestTemplate",
        "org.springframework.web.reactive.function.client.WebClient", "WebClient");

    @Override
    public String id() {
        return "S57";
    }

    @Override
    public int minBoot() {
        return 302;
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        for (Object item : file.ast().imports()) {
            ImportDeclaration declaration = (ImportDeclaration) item;
            String type = REPLACED.get(declaration.getName().getFullyQualifiedName());
            if (type != null) {
                findings.add(file.finding(declaration, id(), "Use `RestClient` (or an `@HttpExchange` interface on it) instead of `"
                    + type + "`, inside a `<Target>HttpClient`."));
            }
        }
        return findings;
    }

}
