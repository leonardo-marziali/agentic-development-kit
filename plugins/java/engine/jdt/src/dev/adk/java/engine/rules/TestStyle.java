package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.ImportDeclaration;
import org.eclipse.jdt.core.dom.MethodDeclaration;

/* T2: tests are named shouldXWhenY and assert with AssertJ. */
final class TestStyle implements Rule {

    private static final Pattern NAME = Pattern.compile("should[A-Z]\\w*When[A-Z]\\w*");

    private static final List<String> OTHER_ASSERTIONS = List.of("org.junit.jupiter.api.Assertions", "org.junit.Assert");

    @Override
    public String id() {
        return "T2";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        if (!file.isTest()) {
            return List.of();
        }
        List<Finding> findings = new ArrayList<>();
        for (Object item : file.ast().imports()) {
            ImportDeclaration declaration = (ImportDeclaration) item;
            String name = declaration.getName().getFullyQualifiedName();
            if (OTHER_ASSERTIONS.stream().anyMatch(name::startsWith)) {
                findings.add(file.finding(declaration, id(), "Assert with AssertJ (`assertThat`), not `" + name + "`."));
            }
        }
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodDeclaration node) {
                boolean isTest = Ast.hasAnnotation(node, "Test") || Ast.hasAnnotation(node, "ParameterizedTest");
                if (isTest && !NAME.matcher(node.getName().getIdentifier()).matches()) {
                    findings.add(new Finding(file.line(node.getName()), id(), "Name the test `should<Outcome>When<Condition>`, not `"
                        + node.getName().getIdentifier() + "`."));
                }
                return true;
            }
        });
        return findings;
    }

}
