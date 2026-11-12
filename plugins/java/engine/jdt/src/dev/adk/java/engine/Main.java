package dev.adk.java.engine;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.eclipse.jdt.core.compiler.IProblem;
import org.eclipse.jdt.core.dom.AST;
import org.eclipse.jdt.core.dom.ASTParser;
import org.eclipse.jdt.core.dom.CompilationUnit;

/*
 * Entry point of the JDT engine, driven by scripts/hooks/engine.js:
 *
 *   Main --request <file> [--profile <xml|prefs>] [--rules on|off]
 *        [--disabled ID,ID] [--source <level>] [--boot <major.minor>|none]
 *        [--nullness jspecify|spring|auto]
 *
 * For each requested file: parse it; a file with syntax errors is reported
 * and left alone; otherwise format the requested ranges, then run the rules.
 * One file's failure never stops the others.
 */
public final class Main {

    private final PrintStream out;

    private final Map<String, String> options;

    private final Formatter formatter;

    private final int javaLevel;

    private Main(PrintStream out, Map<String, String> options, int javaLevel) {
        this.out = out;
        this.options = options;
        this.formatter = new Formatter(options);
        this.javaLevel = javaLevel;
    }

    public static void main(String[] args) throws Exception {
        Arguments arguments = Arguments.parse(args);
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        Main main = new Main(out, Profiles.load(arguments.profile(), arguments.source()), arguments.source());
        for (Request request : Request.read(arguments.request())) {
            main.process(request, arguments);
        }
        out.flush();
    }

    private void process(Request request, Arguments arguments) {
        Path path = request.path();
        try {
            String source = Files.readString(path, StandardCharsets.UTF_8);
            if (hasSyntaxErrors(source)) {
                error(path, "has syntax errors; not formatted or checked");
                return;
            }
            if (request.formats()) {
                String formatted = formatter.format(source, request);
                if (formatted == null) {
                    error(path, "could not be formatted");
                } else if (!formatted.equals(source)) {
                    Files.writeString(path, formatted, StandardCharsets.UTF_8);
                    out.println("FORMATTED\t" + path);
                    source = formatted;
                }
            }
            if (arguments.rules()) {
                for (Finding finding : Rules.check(path, source, parse(source), arguments)) {
                    out.println("FINDING\t" + path + "\t" + finding.line() + "\t" + finding.rule() + "\t"
                        + oneLine(finding.message()));
                }
            }
        } catch (Exception | LinkageError exception) {
            error(path, exception.getClass().getSimpleName() + ": " + exception.getMessage());
        }
    }

    CompilationUnit parse(String source) {
        ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
        parser.setKind(ASTParser.K_COMPILATION_UNIT);
        parser.setCompilerOptions(options);
        parser.setSource(source.toCharArray());
        return (CompilationUnit) parser.createAST(null);
    }

    private boolean hasSyntaxErrors(String source) {
        return Arrays.stream(parse(source).getProblems()).anyMatch(IProblem::isError);
    }

    private void error(Path path, String message) {
        out.println("ERROR\t" + path + "\t" + oneLine(message));
    }

    private static String oneLine(String text) {
        return String.valueOf(text).replaceAll("[\\t\\r\\n]+", " ");
    }

    int javaLevel() {
        return javaLevel;
    }

    /*
     * Command-line options. bootVersion is major*100+minor (302 = Boot 3.2),
     * or 0 when the module doesn't use Spring Boot.
     */
    record Arguments(Path request, Path profile, boolean rules, Set<String> disabled, int source,
        int bootVersion, String nullness) {

        static Arguments parse(String[] args) {
            Path request = null;
            Path profile = null;
            boolean rules = false;
            Set<String> disabled = new HashSet<>();
            int source = 17;
            int boot = 0;
            String nullness = "auto";
            for (int i = 0; i < args.length; i++) {
                String value = i + 1 < args.length ? args[i + 1] : "";
                switch (args[i]) {
                    case "--request" -> request = Path.of(value);
                    case "--profile" -> profile = Path.of(value);
                    case "--rules" -> rules = value.equals("on");
                    case "--disabled" -> disabled.addAll(List.of(value.split(",")));
                    case "--source" -> source = Integer.parseInt(value);
                    case "--boot" -> boot = bootVersion(value);
                    case "--nullness" -> nullness = value;
                    default -> {
                        continue;
                    }
                }
                i++;
            }
            if (request == null) {
                throw new IllegalArgumentException("--request is required");
            }
            return new Arguments(request, profile, rules, disabled, source, boot, nullness);
        }

        private static int bootVersion(String value) {
            if (value.equals("none")) {
                return 0;
            }
            String[] parts = value.split("\\.");
            return Integer.parseInt(parts[0]) * 100 + (parts.length > 1 ? Integer.parseInt(parts[1]) : 0);
        }

    }

}
