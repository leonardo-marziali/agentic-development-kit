package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BiConsumer;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.Modifier;
import org.eclipse.jdt.core.dom.TypeDeclaration;

/*
 * Class-level rules keyed by a type's annotations and name:
 *   S6  @Configuration / @RestController / @Controller classes aren't public;
 *   S14 read DTOs are immutable (@Value @Builder), never @Data;
 *   S22 MapStruct mappers are abstract classes, not interfaces.
 */
final class TypeAnnotations {

    private TypeAnnotations() {
    }

    static List<Finding> visitTypes(SourceFile file, BiConsumer<TypeDeclaration, List<Finding>> inspect) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(TypeDeclaration node) {
                inspect.accept(node, findings);
                return true;
            }
        });
        return findings;
    }

    static final class NotPublic implements Rule {

        private static final List<String> MANAGED = List.of("Configuration", "RestController", "Controller");

        @Override
        public String id() {
            return "S6";
        }

        @Override
        public List<Finding> check(SourceFile file) {
            return visitTypes(file, (type, findings) -> {
                String annotation = MANAGED.stream().filter(a -> Ast.hasAnnotation(type, a)).findFirst().orElse(null);
                if (annotation != null && Modifier.isPublic(type.getModifiers())) {
                    findings.add(new Finding(file.line(type.getName()), id(),
                        "Make `@" + annotation + "` class `" + type.getName() + "` package-private: nothing outside its package uses it directly."));
                }
            });
        }

    }

    static final class ImmutableReadDto implements Rule {

        @Override
        public String id() {
            return "S14";
        }

        @Override
        public List<Finding> check(SourceFile file) {
            return visitTypes(file, (type, findings) -> {
                if (type.getName().getIdentifier().endsWith("ReadDto") && Ast.hasAnnotation(type, "Data")) {
                    findings.add(new Finding(file.line(type.getName()), id(),
                        "Make read DTO `" + type.getName() + "` immutable with `@Value` and `@Builder` instead of `@Data`."));
                }
            });
        }

    }

    static final class AbstractMapper implements Rule {

        @Override
        public String id() {
            return "S22";
        }

        @Override
        public List<Finding> check(SourceFile file) {
            return visitTypes(file, (type, findings) -> {
                if (type.isInterface() && Ast.hasAnnotation(type, "Mapper")) {
                    findings.add(new Finding(file.line(type.getName()), id(),
                        "Make mapper `" + type.getName() + "` an abstract class: `public final` nullability proxies over `protected abstract` mapping methods."));
                }
            });
        }

    }

}
