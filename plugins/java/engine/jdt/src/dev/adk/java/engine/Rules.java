package dev.adk.java.engine;

import dev.adk.java.engine.rules.RuleRegistry;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.CompilationUnit;

/* Runs every applicable rule on one file, then applies suppressions. */
final class Rules {

    private Rules() {
    }

    static List<Finding> check(Path path, String source, CompilationUnit ast, Main.Arguments arguments) {
        SourceFile file = SourceFile.of(path, source, ast, arguments.source(), arguments.nullness());
        List<Finding> findings = new ArrayList<>();
        for (Rule rule : RuleRegistry.all()) {
            if (applies(rule, arguments)) {
                findings.addAll(rule.check(file));
            }
        }
        List<Finding> remaining = Suppressions.filter(file, findings);
        remaining.removeIf(finding -> arguments.disabled().contains(finding.rule()));
        remaining.sort((a, b) -> a.line() != b.line() ? Integer.compare(a.line(), b.line()) : a.rule().compareTo(b.rule()));
        return remaining;
    }

    private static boolean applies(Rule rule, Main.Arguments arguments) {
        if (arguments.disabled().contains(rule.id())) {
            return false;
        }
        if (rule.minJava() > arguments.source()) {
            return false;
        }
        return rule.minBoot() == 0 || (arguments.bootVersion() != 0 && arguments.bootVersion() >= rule.minBoot());
    }

}
