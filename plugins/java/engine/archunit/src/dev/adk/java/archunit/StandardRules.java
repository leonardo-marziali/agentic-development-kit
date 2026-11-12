package dev.adk.java.archunit;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The standard's architecture rules, keyed by rule ID. Annotations and types
 * are named as strings, so this compiles against ArchUnit alone and works on
 * any project's classes without its dependencies on the classpath.
 */
public final class StandardRules {

    private static final String[] FRAMEWORKS = {"org.springframework..", "jakarta.persistence..",
        "javax.persistence..", "com.fasterxml.jackson..", "jakarta.validation..", "javax.validation.."};

    private StandardRules() {
    }

    public static Map<String, ArchRule> all(String basePackage) {
        Map<String, ArchRule> rules = new LinkedHashMap<>();
        rules.put("S24", methods().that().areDeclaredInClassesThat().haveSimpleNameEndingWith("Service")
            .and().areDeclaredInClassesThat().areInterfaces().and().arePublic()
            .should().haveNameMatching("save|update|delete|find[A-Z]?\\w*|handle")
            .because("services use the fixed vocabulary save, update, delete, find*, and handle for use cases (S24)"));
        rules.put("S24-mapper", methods().that().areDeclaredInClassesThat().areAnnotatedWith("org.mapstruct.Mapper")
            .and().arePublic().should().haveNameMatching("to[A-Z]\\w*|update[A-Z]\\w*")
            .because("mapper methods are toDomain, toEntity, toReadDto, toWriteDto, toFilter or update* (S24)"));
        rules.put("S7", methods().that().areDeclaredInClassesThat().resideInAnyPackage("..service..", "..persistence..")
            .and().areDeclaredInClassesThat().areInterfaces().and().arePublic()
            .should(speakOnlyDomainObjects())
            .because("service and repository interfaces take and return domain objects only (S7)"));
        rules.put("D1", noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAnyPackage(FRAMEWORKS)
            .because("domain classes are plain Java: no Spring, JPA, Jackson or Bean Validation (D1)"));
        rules.put("D5", methods().that().haveName("rehydrate")
            .should().onlyBeCalled().byClassesThat().haveSimpleNameContaining("Mapper")
            .because("persisted domain objects are rebuilt only by mappers (D5)"));
        rules.put("S47", classes().that().areAnnotatedWith("jakarta.persistence.Entity")
            .or().areAnnotatedWith("javax.persistence.Entity")
            .should(haveFieldOfType("AuditEmbeddable"))
            .because("every entity embeds the framework-filled AuditEmbeddable (S47)"));
        rules.put("S40", classes().that().areAnnotatedWith("org.springframework.web.bind.annotation.RestControllerAdvice")
            .should().beAssignableTo("org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler")
            .because("one advice extending ResponseEntityExceptionHandler keeps Spring's own errors correct (S40)"));
        rules.put("S6", classes().that().areAnnotatedWith("org.springframework.context.annotation.Configuration")
            .or().areAnnotatedWith("org.springframework.web.bind.annotation.RestController")
            .or().areAnnotatedWith("org.springframework.stereotype.Controller")
            .or().haveSimpleNameEndingWith("ServiceImpl").or().haveSimpleNameEndingWith("RepositoryImpl")
            .should().notBePublic()
            .because("managed classes and implementations get the lowest visibility (S6)"));
        if (basePackage != null && !basePackage.isBlank()) {
            rules.put("S25", slices().matching(basePackage + ".(*)..").should().beFreeOfCycles()
                .because("features don't depend on each other in cycles (S25)"));
        }
        return rules;
    }

    private static ArchCondition<JavaMethod> speakOnlyDomainObjects() {
        return new ArchCondition<>("mention no *Dto or *Entity type") {
            @Override
            public void check(JavaMethod method, ConditionEvents events) {
                mention(method, method.getRawReturnType(), events);
                for (JavaClass parameter : method.getRawParameterTypes()) {
                    mention(method, parameter, events);
                }
            }

            private void mention(JavaMethod method, JavaClass type, ConditionEvents events) {
                String name = type.getSimpleName();
                if (name.endsWith("Dto") || name.endsWith("Entity")) {
                    events.add(SimpleConditionEvent.violated(method, method.getDescription() + " uses " + name
                        + " in " + method.getSourceCodeLocation()));
                }
            }
        };
    }

    private static ArchCondition<JavaClass> haveFieldOfType(String simpleName) {
        return new ArchCondition<>("have a field of type " + simpleName) {
            @Override
            public void check(JavaClass javaClass, ConditionEvents events) {
                boolean found = javaClass.getAllFields().stream()
                    .anyMatch(field -> field.getRawType().getSimpleName().equals(simpleName));
                if (!found) {
                    events.add(SimpleConditionEvent.violated(javaClass, "Class <" + javaClass.getName() + "> has no "
                        + simpleName + " field in " + javaClass.getSourceCodeLocation()));
                }
            }
        };
    }

}
