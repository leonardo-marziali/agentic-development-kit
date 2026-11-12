package dev.adk.java.engine;

import java.nio.file.Path;
import java.util.List;
import org.eclipse.jdt.core.dom.CompilationUnit;

/* The source rules; added in the next task. */
final class Rules {

    private Rules() {
    }

    static List<Finding> check(Path path, String source, CompilationUnit ast, Main.Arguments arguments) {
        return List.of();
    }

}
