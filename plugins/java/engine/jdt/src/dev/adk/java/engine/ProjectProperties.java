package dev.adk.java.engine;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The `.properties` files of a source file's module (`src/main/resources`),
 * so rules can resolve the `${…}` placeholders Spring would, such as a
 * controller path read from `api-paths.properties` (S62).
 */
public final class ProjectProperties {

    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([^}:]+)(?::([^}]*))?}");

    private static final int MAX_DEPTH = 10;

    private static final Map<Path, ProjectProperties> CACHE = new ConcurrentHashMap<>();

    private static final ProjectProperties NONE = new ProjectProperties(new Properties());

    private final Properties values;

    private ProjectProperties(Properties values) {
        this.values = values;
    }

    /** The properties next to the `src/main/java` or `src/test/java` tree holding this file, or none. */
    public static ProjectProperties forSource(Path source) {
        Path resources = resourcesOf(source.toAbsolutePath().normalize());
        return resources == null ? NONE : CACHE.computeIfAbsent(resources, ProjectProperties::load);
    }

    /** The value with every placeholder resolved, or null when one has no value and no default. */
    public String resolve(String value) {
        return resolve(value, 0);
    }

    private String resolve(String value, int depth) {
        if (depth > MAX_DEPTH) {
            return null;
        }
        Matcher matcher = PLACEHOLDER.matcher(value);
        StringBuilder resolved = new StringBuilder();
        while (matcher.find()) {
            String replacement = values.getProperty(matcher.group(1), matcher.group(2));
            String nested = replacement == null ? null : resolve(replacement, depth + 1);
            if (nested == null) {
                return null;
            }
            matcher.appendReplacement(resolved, Matcher.quoteReplacement(nested));
        }
        matcher.appendTail(resolved);
        return resolved.toString();
    }

    private static Path resourcesOf(Path source) {
        for (Path dir = source.getParent(); dir != null; dir = dir.getParent()) {
            Path parent = dir.getParent();
            if (dir.getFileName() != null && dir.getFileName().toString().equals("java") && parent != null
                && parent.getParent() != null && parent.getParent().getFileName() != null
                && parent.getParent().getFileName().toString().equals("src")) {
                return parent.getParent().resolve("main").resolve("resources");
            }
        }
        return null;
    }

    // Sorted, so a key defined twice resolves the same way on every machine.
    private static ProjectProperties load(Path resources) {
        Properties values = new Properties();
        if (!Files.isDirectory(resources)) {
            return NONE;
        }
        try (DirectoryStream<Path> files = Files.newDirectoryStream(resources, "*.properties")) {
            List<Path> sorted = new ArrayList<>();
            files.forEach(sorted::add);
            sorted.sort(null);
            for (Path file : sorted) {
                try (InputStream in = Files.newInputStream(file)) {
                    values.load(in);
                }
            }
        } catch (IOException e) {
            return NONE;
        }
        return new ProjectProperties(values);
    }

}
