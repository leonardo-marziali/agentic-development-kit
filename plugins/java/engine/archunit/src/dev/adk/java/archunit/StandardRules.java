package dev.adk.java.archunit;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaCall;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.domain.JavaModifier;
import com.tngtech.archunit.core.domain.properties.HasName;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The standard's architecture rules, keyed by rule ID. Annotations and types
 * are named as strings, so this compiles against ArchUnit alone and works on
 * any project's classes without its dependencies on the classpath.
 */
public final class StandardRules {

    private static final String[] FRAMEWORKS = {"org.springframework..", "jakarta..", "javax.persistence..",
        "javax.validation..", "com.fasterxml..", "tools.jackson..", "..shared.error.."};

    private static final String SERVICE = "org.springframework.stereotype.Service";

    private static final String MAPPER = "org.mapstruct.Mapper";

    private static final String COMMAND_SUFFIX = "Command";

    private static final String DOMAIN = "..domain..";

    private static final String APPLICATION = "..application..";

    private static final String ADAPTERS_LAYER = "Adapters";

    private static final String APPLICATION_LAYER = "Application";

    private static final String DOMAIN_LAYER = "Domain";

    private static final String[] ADAPTERS = {"api", "messaging", "persistence", "client", "scheduler"};

    private StandardRules() {
    }

    public static Map<String, ArchRule> all(String basePackage) {
        Map<String, ArchRule> rules = new LinkedHashMap<>();
        rules.put("S24", methods().that().areDeclaredInClassesThat().resideInAPackage(DOMAIN)
            .and().areDeclaredInClassesThat().haveSimpleNameEndingWith("Repository")
            .and().areDeclaredInClassesThat().areInterfaces().and().arePublic()
            .should().haveNameMatching("save|update|delete|getById|getByIdForUpdate|findById|nextIdentity|nextIdentities")
            .because("repositories use the fixed vocabulary save, update, delete, getById, getByIdForUpdate, findById,"
                + " nextIdentity and nextIdentities (S24)"));
        rules.put("S24-queries", methods().that().areDeclaredInClassesThat().resideInAPackage(APPLICATION)
            .and().areDeclaredInClassesThat().haveSimpleNameEndingWith("Queries")
            .and().areDeclaredInClassesThat().areInterfaces().and().arePublic()
            .should().haveNameMatching("(get|find)[A-Z]\\w*")
            .because("query services read with get* (never empty) and find* methods only (S24)"));
        rules.put("S24-mapper", methods().that().areDeclaredInClassesThat().areAnnotatedWith(MAPPER)
            .and().arePublic().should().haveNameMatching("to[A-Z]\\w*|update[A-Z]\\w*")
            .because("mapper methods are to* or update* (S24)"));
        rules.put("S11", classes().that().areAnnotatedWith(SERVICE).and().areNotInterfaces()
            .should(haveOnlyPublicExecute())
            .because("an application service exposes exactly one public method, execute, taking one *Command (S11)"));
        rules.put("S11-port", classes().that().resideInAPackage(APPLICATION)
            .and().areInterfaces().and().arePublic().and().areTopLevelClasses()
            .and().haveSimpleNameNotEndingWith("Queries")
            .should(declareOneExecute())
            .because("a port declares one abstract execute, taking its own <Port>Command or nothing and returning"
                + " nothing or the identifier it created (S11)"));
        rules.put("S11-builder", classes().that().resideInAPackage(APPLICATION)
            .and().haveSimpleNameEndingWith(COMMAND_SUFFIX).and().areNotInterfaces()
            .and().areNotEnums().and().areTopLevelClasses()
            .should(haveStaticStepBuilder())
            .because("a command is built with a step builder, through a public static builder() returning its first"
                + " step (S11)"));
        rules.put("S12", classes().that().areAnnotatedWith(SERVICE)
            .should().resideInAPackage(APPLICATION).andShould().haveSimpleNameEndingWith("Service")
            .because("@Service marks application services only, named <Port>Service in application (S12)"));
        rules.put("S7", methods().that().areDeclaredInClassesThat().resideInAnyPackage(APPLICATION, DOMAIN)
            .and().areDeclaredInClassesThat().areInterfaces().and().arePublic()
            .should(speakOnlyDomainObjects())
            .because("ports take commands and domain objects and return read models or domain objects, never DTOs or"
                + " entities (S7)"));
        rules.put("D15", noClasses().that().resideInAPackage(DOMAIN)
            .should().dependOnClassesThat().resideInAnyPackage(FRAMEWORKS)
            .because("domain classes are plain Java: no Spring, JPA, Jackson, Bean Validation or HTTP errors (D15)"));
        rules.put("S19", noClasses().that().resideOutsideOfPackage("..mapping..")
            .and().areNotAnnotatedWith(MAPPER).and().haveSimpleNameNotEndingWith("MapperImpl")
            .should().dependOnClassesThat().resideInAPackage("..mapping..")
            .because("converters in mapping serve MapStruct only: hand-written code converts through the value object"
                + " itself (S19)"));
        rules.put("D19", noClasses().that().resideOutsideOfPackage("..persistence..")
            .should().callMethodWhere(JavaCall.Predicates.target(HasName.Predicates.name("reconstitute")))
            .because("only the persistence adapter reconstitutes stored aggregates (D19)"));
        rules.put("D8", layeredArchitecture().consideringOnlyDependenciesInLayers().withOptionalLayers(true)
            .layer(ADAPTERS_LAYER).definedBy(adapterPackages())
            .layer(APPLICATION_LAYER).definedBy(APPLICATION)
            .layer(DOMAIN_LAYER).definedBy(DOMAIN)
            .whereLayer(ADAPTERS_LAYER).mayNotBeAccessedByAnyLayer()
            .whereLayer(APPLICATION_LAYER).mayOnlyBeAccessedByLayers(ADAPTERS_LAYER)
            .whereLayer(DOMAIN_LAYER).mayOnlyBeAccessedByLayers(APPLICATION_LAYER, ADAPTERS_LAYER)
            .because("dependencies point into the core: adapters depend on application and domain, never the other"
                + " way around (D8)"));
        for (String adapter : ADAPTERS) {
            rules.put("D8-" + adapter, noClasses().that().resideInAPackage(".." + adapter + "..")
                .should().dependOnClassesThat().resideInAnyPackage(otherAdapters(adapter))
                .because("adapters never call each other: each one delegates to a port (D8)"));
        }
        rules.put("D8-messaging-in", noClasses().that().resideInAPackage("..messaging.in..")
            .should().dependOnClassesThat().resideInAPackage("..messaging.out..")
            .because("messaging.in and messaging.out are two adapters that never depend on each other (D8)"));
        rules.put("D8-messaging-out", noClasses().that().resideInAPackage("..messaging.out..")
            .should().dependOnClassesThat().resideInAPackage("..messaging.in..")
            .because("messaging.in and messaging.out are two adapters that never depend on each other (D8)"));
        rules.put("S47", classes().that().areAnnotatedWith("jakarta.persistence.Entity")
            .or().areAnnotatedWith("javax.persistence.Entity")
            .should(haveFieldOfType("AuditEmbeddable"))
            .because("every entity embeds the framework-filled AuditEmbeddable (S47)"));
        rules.put("S40", classes().that().areAnnotatedWith("org.springframework.web.bind.annotation.RestControllerAdvice")
            .should().beAssignableTo("org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler")
            .orShould().beAssignableTo("org.springframework.web.reactive.result.method.annotation.ResponseEntityExceptionHandler")
            .because("one advice extending ResponseEntityExceptionHandler (servlet or WebFlux) keeps Spring's own errors correct (S40)"));
        rules.put("S6", classes().that().areAnnotatedWith("org.springframework.context.annotation.Configuration")
            .or().areAnnotatedWith("org.springframework.web.bind.annotation.RestController")
            .or().areAnnotatedWith("org.springframework.stereotype.Controller")
            .or(arePortImplementations())
            .should().notBePublic()
            .because("managed classes and port implementations get the lowest visibility: callers depend on the port (S6)"));
        if (basePackage != null && !basePackage.isBlank()) {
            rules.put("S25", slices().matching(basePackage + ".(*)..").should().beFreeOfCycles()
                .because("features don't depend on each other in cycles (S25)"));
        }
        return rules;
    }

    private static String[] adapterPackages() {
        return Arrays.stream(ADAPTERS).map(adapter -> ".." + adapter + "..").toArray(String[]::new);
    }

    private static String[] otherAdapters(String adapter) {
        return Arrays.stream(ADAPTERS).filter(other -> !other.equals(adapter)).map(other -> ".." + other + "..")
            .toArray(String[]::new);
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

    private static String classLabel(JavaClass javaClass) {
        return "Class <" + javaClass.getName() + ">";
    }

    private static boolean generated(JavaMethod method) {
        return method.getModifiers().contains(JavaModifier.SYNTHETIC) || method.getModifiers().contains(JavaModifier.BRIDGE);
    }

    private static boolean command(JavaClass type) {
        return type.getSimpleName().endsWith(COMMAND_SUFFIX);
    }

    // Compiler-generated members (bridge methods, lambdas) aren't the author's API.
    private static ArchCondition<JavaClass> haveOnlyPublicExecute() {
        return new ArchCondition<>("have exactly one public method, execute, taking one *Command") {
            @Override
            public void check(JavaClass javaClass, ConditionEvents events) {
                List<JavaMethod> publicMethods = javaClass.getMethods().stream()
                    .filter(method -> method.getModifiers().contains(JavaModifier.PUBLIC))
                    .filter(method -> !generated(method))
                    .toList();
                List<String> names = publicMethods.stream().map(JavaMethod::getName).distinct().sorted().toList();
                if (!names.equals(List.of("execute"))) {
                    events.add(SimpleConditionEvent.violated(javaClass, classLabel(javaClass)
                        + " has public methods " + names + " instead of only execute in "
                        + javaClass.getSourceCodeLocation()));
                    return;
                }
                for (JavaMethod method : publicMethods) {
                    List<JavaClass> parameters = method.getRawParameterTypes();
                    if (!parameters.isEmpty() && !(parameters.size() == 1 && command(parameters.get(0)))) {
                        events.add(SimpleConditionEvent.violated(method, method.getDescription() + " takes "
                            + parameters.stream().map(JavaClass::getSimpleName).toList()
                            + " instead of one <Port>Command in " + method.getSourceCodeLocation()));
                    }
                }
            }
        };
    }

    /*
     * Application services, and classes outside domain that implement a
     * feature's port. Domain events implement interfaces in domain and stay
     * public, so domain is left out; the name doesn't matter (D6).
     */
    private static DescribedPredicate<JavaClass> arePortImplementations() {
        return DescribedPredicate.describe("port implementations",
            javaClass -> javaClass.isAnnotatedWith(SERVICE)
                || (!javaClass.getPackageName().matches(".*\\.domain(\\..*)?")
                    && javaClass.getAllRawInterfaces().stream().anyMatch(StandardRules::isFeaturePort)));
    }

    // A port is a public top-level interface in a feature's domain or application package.
    private static boolean isFeaturePort(JavaClass javaInterface) {
        return javaInterface.getModifiers().contains(JavaModifier.PUBLIC) && javaInterface.isTopLevelClass()
            && javaInterface.getPackageName().matches(".*\\.(domain|application)(\\..*)?")
            && !javaInterface.getPackageName().contains(".shared.");
    }

    /*
     * One abstract execute() or execute(<Port>Command), returning void or an
     * identifier (*Id). A default execute may take a Function from the
     * command's first step to its final step (the compiler then still checks
     * every mandatory value): never a list of separate arguments.
     */
    private static ArchCondition<JavaClass> declareOneExecute() {
        return new ArchCondition<>("declare one abstract execute(<Port>Command) or execute()") {
            @Override
            public void check(JavaClass port, ConditionEvents events) {
                List<JavaMethod> abstractMethods = port.getMethods().stream()
                    .filter(method -> method.getModifiers().contains(JavaModifier.ABSTRACT))
                    .filter(method -> !generated(method))
                    .toList();
                List<String> names = abstractMethods.stream().map(JavaMethod::getName).sorted().toList();
                if (!names.equals(List.of("execute"))) {
                    events.add(SimpleConditionEvent.violated(port, classLabel(port) + " declares abstract methods "
                        + names + " instead of one execute in " + port.getSourceCodeLocation()));
                    return;
                }
                JavaMethod execute = abstractMethods.get(0);
                List<JavaClass> parameters = execute.getRawParameterTypes();
                String commandName = port.getName() + COMMAND_SUFFIX;
                if (!parameters.isEmpty() && !(parameters.size() == 1 && parameters.get(0).getName().equals(commandName))) {
                    events.add(SimpleConditionEvent.violated(execute, execute.getDescription() + " takes "
                        + parameters.stream().map(JavaClass::getSimpleName).toList() + " instead of one "
                        + port.getSimpleName() + "Command or nothing in " + execute.getSourceCodeLocation()));
                }
                JavaClass result = execute.getRawReturnType();
                if (!result.getName().equals("void") && !result.getSimpleName().endsWith("Id")) {
                    events.add(SimpleConditionEvent.violated(execute, execute.getDescription() + " returns "
                        + result.getSimpleName() + ": return nothing, or the identifier of what it created, and read"
                        + " the rest through a query service in " + execute.getSourceCodeLocation()));
                }
                port.getMethods().stream()
                    .filter(method -> method.getName().equals("execute") && !abstractMethods.contains(method))
                    .filter(method -> !generated(method))
                    .filter(method -> !method.getRawParameterTypes().stream().map(JavaClass::getName).toList()
                        .equals(List.of("java.util.function.Function")))
                    .forEach(method -> events.add(SimpleConditionEvent.violated(method, method.getDescription()
                        + " takes " + method.getRawParameterTypes().stream().map(JavaClass::getSimpleName).toList()
                        + ": a default execute takes only a Function over the command's steps in "
                        + method.getSourceCodeLocation())));
            }
        };
    }

    /*
     * The first step of a step builder is an interface; Lombok's @Builder
     * returns a class, which fills a forgotten value with null or 0.
     */
    private static ArchCondition<JavaClass> haveStaticStepBuilder() {
        return new ArchCondition<>("have a static builder() returning its first step") {
            @Override
            public void check(JavaClass javaClass, ConditionEvents events) {
                JavaMethod builder = javaClass.getMethods().stream()
                    .filter(method -> method.getName().equals("builder") && method.getParameters().isEmpty()
                        && method.getModifiers().containsAll(Set.of(JavaModifier.PUBLIC, JavaModifier.STATIC)))
                    .findFirst().orElse(null);
                if (builder == null) {
                    events.add(SimpleConditionEvent.violated(javaClass, classLabel(javaClass)
                        + " has no public static builder() method in " + javaClass.getSourceCodeLocation()));
                } else if (!builder.getRawReturnType().isInterface()
                    || !builder.getRawReturnType().getEnclosingClass().map(javaClass::equals).orElse(false)) {
                    events.add(SimpleConditionEvent.violated(javaClass, classLabel(javaClass)
                        + "'s builder() returns " + builder.getRawReturnType().getSimpleName()
                        + ", not the interface of its own first step: use a nested step builder, not Lombok's @Builder, in "
                        + javaClass.getSourceCodeLocation()));
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
                    events.add(SimpleConditionEvent.violated(javaClass, classLabel(javaClass) + " has no "
                        + simpleName + " field in " + javaClass.getSourceCodeLocation()));
                }
            }
        };
    }

}
