package dev.adk.java.archunit;

import com.tngtech.archunit.ArchConfiguration;
import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.EvaluationResult;
import com.tngtech.archunit.library.freeze.FreezingArchRule;
import java.io.File;
import java.io.PrintStream;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/*
 * Runs the standard's ArchUnit rules (plus a project's own, if any) over a
 * project's compiled classes, outside its build:
 *
 *   Runner --classes <dir:dir> [--packages p..,q..] [--base-package com.acme]
 *          [--disabled ID,ID] [--store <dir>] [--create-store]
 *          [--extra <compiled project rules dir>]
 *
 * Prints FINDING TAB <package path/File.java or -> TAB <line> TAB <ID> TAB
 * <message> per violation, ERROR TAB - TAB <message> when a rule can't run.
 *
 * ArchUnit's configuration is set here, after a reset, so a project's own
 * archunit.properties can neither redirect the freeze store nor change
 * behavior. With --store, every rule is a FreezingArchRule over that store;
 * only --create-store may create it, so a session can't freeze its own
 * violations.
 */
public final class Runner {

    private static final Pattern LOCATION = Pattern.compile("\\(([\\w$]+\\.java):(\\d+)\\)");

    private static final Pattern NAMED = Pattern.compile("<([^<>]+)>");

    private Runner() {
    }

    public static void main(String[] args) throws Exception {
        Map<String, String> options = options(args);
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        configure(options);

        List<Path> classDirs = Stream.of(options.getOrDefault("--classes", "").split(File.pathSeparator))
            .filter(s -> !s.isBlank()).map(Path::of).filter(Files::isDirectory).toList();
        if (classDirs.isEmpty()) {
            out.println("ERROR\t-\tno compiled classes to analyse");
            return;
        }
        JavaClasses classes = new ClassFileImporter().importPaths(classDirs);
        List<String> packages = list(options.get("--packages"));
        if (!packages.isEmpty()) {
            classes = classes.that(resideInAny(packages));
        }

        Set<String> disabled = new HashSet<>(list(options.get("--disabled")));
        Map<String, ArchRule> rules = new LinkedHashMap<>(StandardRules.all(options.get("--base-package")));
        if (options.containsKey("--extra")) {
            rules.putAll(projectRules(Path.of(options.get("--extra"))));
        }
        boolean frozen = options.containsKey("--store");
        boolean creating = options.containsKey("--create-store");
        Set<String> recorded = frozen ? recordedRules(Path.of(options.get("--store"))) : Set.of();
        for (Map.Entry<String, ArchRule> entry : rules.entrySet()) {
            String id = entry.getKey().replaceAll("-.*$", "");
            if (disabled.contains(id) || disabled.contains(entry.getKey())) {
                continue;
            }
            /*
             * A rule the baseline never recorded (a new project rule, a newly
             * set base package, a reworded rule) is checked unfrozen: freezing
             * it would silently store the session's own violations.
             */
            boolean freeze = frozen && (creating || recorded.contains(entry.getValue().getDescription()));
            ArchRule rule = freeze ? FreezingArchRule.freeze(entry.getValue()) : entry.getValue();
            try {
                report(out, id, rule.evaluate(classes));
            } catch (RuntimeException exception) {
                out.println("ERROR\t-\t" + id + ": " + oneLine(String.valueOf(exception.getMessage())));
            }
        }
        out.flush();
    }

    // The rule descriptions a freeze store holds (its stored.rules index).
    private static Set<String> recordedRules(Path store) throws java.io.IOException {
        Path index = store.resolve("stored.rules");
        if (!Files.exists(index)) {
            return Set.of();
        }
        java.util.Properties properties = new java.util.Properties();
        try (java.io.Reader reader = Files.newBufferedReader(index, StandardCharsets.UTF_8)) {
            properties.load(reader);
        }
        return properties.stringPropertyNames();
    }

    private static void configure(Map<String, String> options) {
        ArchConfiguration configuration = ArchConfiguration.get();
        configuration.reset();
        configuration.setResolveMissingDependenciesFromClassPath(false);
        configuration.setProperty("archRule.failOnEmptyShould", "false");
        if (options.containsKey("--store")) {
            configuration.setProperty("freeze.store.default.path", options.get("--store"));
            configuration.setProperty("freeze.store.default.allowStoreCreation",
                String.valueOf(options.containsKey("--create-store")));
            configuration.setProperty("freeze.refreeze", "false");
        }
    }

    private static DescribedPredicate<JavaClass> resideInAny(List<String> packages) {
        return JavaClass.Predicates.resideInAnyPackage(packages.toArray(String[]::new));
    }

    private static void report(PrintStream out, String id, EvaluationResult result) {
        for (String detail : result.getFailureReport().getDetails()) {
            Matcher location = LOCATION.matcher(detail);
            String file = "-";
            int line = 0;
            if (location.find()) {
                line = Integer.parseInt(location.group(2));
                Matcher owner = NAMED.matcher(detail);
                String pkg = owner.find() ? packageOf(className(owner.group(1))) : "";
                file = (pkg.isEmpty() ? "" : pkg.replace('.', '/') + "/") + location.group(1);
            }
            out.println("FINDING\t" + file + "\t" + line + "\t" + id + "\t" + oneLine(detail));
        }
    }

    /*
     * The class in an ArchUnit name: "com.acme.Foo.save(com.acme.Bar)" and
     * "com.acme.Foo.field" are members of com.acme.Foo; "com.acme.Foo" is the
     * class itself (member names start lower case, class names upper case).
     */
    private static String className(String name) {
        String head = name.contains("(") ? name.substring(0, name.indexOf('(')) : name;
        int dot = head.lastIndexOf('.');
        boolean member = dot >= 0 && Character.isLowerCase(head.charAt(dot + 1));
        return member || name.contains("(") ? head.substring(0, Math.max(dot, 0)) : head;
    }

    // "com.acme.project.service.ProjectService" → "com.acme.project.service".
    private static String packageOf(String className) {
        int dot = className.lastIndexOf('.');
        return dot < 0 ? "" : className.substring(0, dot);
    }

    /*
     * A project's own rules: every public static ArchRule field of the classes
     * compiled from .claude/archunit/, named X:<Class>.<field>.
     */
    private static Map<String, ArchRule> projectRules(Path dir) throws Exception {
        Map<String, ArchRule> rules = new LinkedHashMap<>();
        List<Path> classFiles;
        try (Stream<Path> walk = Files.walk(dir)) {
            classFiles = walk.filter(p -> p.toString().endsWith(".class") && !p.toString().contains("$")).toList();
        }
        try (URLClassLoader loader = new URLClassLoader(new URL[] {dir.toUri().toURL()}, Runner.class.getClassLoader())) {
            for (Path classFile : classFiles) {
                String name = dir.relativize(classFile).toString().replace(File.separatorChar, '.').replaceAll("\\.class$", "");
                Class<?> type = loader.loadClass(name);
                for (Field field : type.getFields()) {
                    if (Modifier.isStatic(field.getModifiers()) && ArchRule.class.isAssignableFrom(field.getType())) {
                        rules.put("X:" + type.getSimpleName() + "." + field.getName(), (ArchRule) field.get(null));
                    }
                }
            }
        }
        return rules;
    }

    private static Map<String, String> options(String[] args) {
        Map<String, String> options = new LinkedHashMap<>();
        for (int i = 0; i < args.length; i++) {
            boolean hasValue = i + 1 < args.length && !args[i + 1].startsWith("--");
            options.put(args[i], hasValue ? args[++i] : "");
        }
        return options;
    }

    private static List<String> list(String value) {
        List<String> items = new ArrayList<>();
        if (value != null) {
            for (String item : value.split(",")) {
                if (!item.isBlank()) {
                    items.add(item.trim());
                }
            }
        }
        return items;
    }

    private static String oneLine(String text) {
        return text.replaceAll("[\\t\\r\\n]+", " ");
    }

}
