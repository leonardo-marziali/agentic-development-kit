package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.List;
import java.util.Set;
import org.eclipse.jdt.core.dom.Annotation;
import org.eclipse.jdt.core.dom.FieldDeclaration;
import org.eclipse.jdt.core.dom.NormalAnnotation;
import org.eclipse.jdt.core.dom.SingleMemberAnnotation;
import org.eclipse.jdt.core.dom.TypeDeclaration;

/*
 * Rules for JPA/Mongo entities (classes annotated @Entity or @Document):
 *   S15 no @Data / @EqualsAndHashCode / @ToString, and framework-managed
 *       fields (id, version, audit) expose no setter;
 *   S46 moments in time are Instant, never Date / LocalDateTime / ZonedDateTime.
 */
final class EntityStyle {

    private static final List<String> FORBIDDEN_LOMBOK = List.of("Data", "EqualsAndHashCode", "ToString");

    private static final List<String> MANAGED_FIELDS = List.of("Id", "EmbeddedId", "Version");

    private static final Set<String> LEGACY_TIME = Set.of("Date", "java.util.Date", "LocalDateTime",
        "java.time.LocalDateTime", "ZonedDateTime", "java.time.ZonedDateTime", "Calendar", "java.util.Calendar");

    private EntityStyle() {
    }

    static boolean isEntity(TypeDeclaration type) {
        return Ast.hasAnnotation(type, "Entity") || Ast.hasAnnotation(type, "Document");
    }

    static final class Lombok implements Rule {

        @Override
        public String id() {
            return "S15";
        }

        @Override
        public List<Finding> check(SourceFile file) {
            return TypeAnnotations.visitTypes(file, (type, findings) -> {
                if (!isEntity(type)) {
                    return;
                }
                for (String name : FORBIDDEN_LOMBOK) {
                    Annotation annotation = Ast.annotation(type, name);
                    if (annotation != null) {
                        findings.add(file.finding(annotation, id(), "Remove `@" + name
                            + "` from entity `" + type.getName() + "`: it initializes lazy proxies and recurses on bidirectional relations."));
                    }
                }
                boolean classSetters = Ast.hasAnnotation(type, "Setter") || Ast.hasAnnotation(type, "Data");
                if (!classSetters) {
                    return;
                }
                for (FieldDeclaration field : type.getFields()) {
                    Annotation managed = managedAnnotation(field);
                    if (managed != null && !hasNoSetter(field)) {
                        findings.add(file.finding(managed, id(), "Add `@Setter(AccessLevel.NONE)`: the framework manages this field."));
                    }
                }
            });
        }

        private static Annotation managedAnnotation(FieldDeclaration field) {
            for (String name : MANAGED_FIELDS) {
                Annotation annotation = Ast.annotation(field, name);
                if (annotation != null) {
                    return annotation;
                }
            }
            Annotation embedded = Ast.annotation(field, "Embedded");
            return embedded != null && field.getType().toString().contains("Audit") ? embedded : null;
        }

        private static boolean hasNoSetter(FieldDeclaration field) {
            Annotation setter = Ast.annotation(field, "Setter");
            String value = setter instanceof SingleMemberAnnotation single ? single.getValue().toString()
                : setter instanceof NormalAnnotation normal ? normal.values().toString() : "";
            return value.contains("NONE");
        }

    }

    static final class InstantTimes implements Rule {

        @Override
        public String id() {
            return "S46";
        }

        @Override
        public List<Finding> check(SourceFile file) {
            return TypeAnnotations.visitTypes(file, (type, findings) -> {
                if (!isEntity(type)) {
                    return;
                }
                for (FieldDeclaration field : type.getFields()) {
                    String name = field.getType().toString();
                    if (LEGACY_TIME.contains(name)) {
                        findings.add(file.finding(field, id(), "Store this moment as a UTC `Instant`, not `" + name
                            + "` (keep `LocalDate` for true calendar dates)."));
                    }
                }
            });
        }

    }

}
