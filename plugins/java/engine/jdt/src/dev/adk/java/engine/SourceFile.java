package dev.adk.java.engine;

import java.nio.file.Path;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTNode;
import org.eclipse.jdt.core.dom.CompilationUnit;

/**
 * A parsed file as the rules see it: no bindings, so rules reason about names
 * and syntax only.
 */
public record SourceFile(Path path, String source, CompilationUnit ast, boolean inTestSources, int javaLevel,
    String nullness, List<String> lines) {

    public static SourceFile of(Path path, String source, CompilationUnit ast, int javaLevel, String nullness) {
        return new SourceFile(path, source, ast, isTestSourcePath(path), javaLevel, nullness, List.of(source.split("\r?\n", -1)));
    }

    public int line(ASTNode node) {
        return ast.getLineNumber(node.getStartPosition());
    }

    public int lineOfOffset(int offset) {
        return ast.getLineNumber(offset);
    }

    public Finding finding(ASTNode node, String rule, String message) {
        return new Finding(line(node), rule, message);
    }

    /** A test class: a `*Test.java` file under `src/test/` (helpers and `*IT` are not). */
    public boolean isTestClass() {
        return inTestSources && path.getFileName().toString().endsWith("Test.java");
    }

    private static boolean isTestSourcePath(Path path) {
        return ("/" + path.toString().replace('\\', '/')).contains("/src/test/");
    }

}
