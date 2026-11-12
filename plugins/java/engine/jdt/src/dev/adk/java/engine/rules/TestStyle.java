package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.AbstractTypeDeclaration;
import org.eclipse.jdt.core.dom.ImportDeclaration;
import org.eclipse.jdt.core.dom.MethodDeclaration;

/*
 * T2: test classes are named *Test, tests are named shouldXWhenY, and they
 * assert with AssertJ. Only `*Test` classes under src/test are checked; a
 * class there with test methods but another name (`*Tests`, `*IT`) is told
 * to rename.
 */
final class TestStyle implements Rule {

    private static final Pattern NAME = Pattern.compile("should[A-Z]\\w*When[A-Z]\\w*");

    private static final List<String> OTHER_ASSERTIONS = List.of("org.junit.jupiter.api.Assertions", "org.junit.Assert");

    @Override
    public String id() {
        return "T2";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        if (!file.inTestSources()) {
            return List.of();
        }
        if (!file.isTestClass()) {
            return misnamedTestClasses(file);
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
                if (isTestMethod(node) && !NAME.matcher(node.getName().getIdentifier()).matches()) {
                    findings.add(new Finding(file.line(node.getName()), id(), "Name the test `should<Outcome>When<Condition>`, not `"
                        + node.getName().getIdentifier() + "`."));
                }
                return true;
            }
        });
        return findings;
    }

    private static boolean isTestMethod(MethodDeclaration method) {
        return Ast.hasAnnotation(method, "Test") || Ast.hasAnnotation(method, "ParameterizedTest");
    }

    private List<Finding> misnamedTestClasses(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        for (Object item : file.ast().types()) {
            AbstractTypeDeclaration type = (AbstractTypeDeclaration) item;
            boolean[] hasTests = {false};
            type.accept(new ASTVisitor() {
                @Override
                public boolean visit(MethodDeclaration node) {
                    hasTests[0] |= isTestMethod(node);
                    return !hasTests[0];
                }
            });
            if (hasTests[0]) {
                String name = type.getName().getIdentifier();
                findings.add(new Finding(file.line(type.getName()), id(), "Name test classes `<Subject>Test`, not `" + name
                    + "`: only `*Test` classes are recognised as tests."));
            }
        }
        return findings;
    }

}
