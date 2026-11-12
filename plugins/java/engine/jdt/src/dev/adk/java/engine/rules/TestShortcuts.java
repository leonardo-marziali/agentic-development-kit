package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.MethodInvocation;
import org.eclipse.jdt.core.dom.TypeLiteral;

/* T7: no field injection by reflection, no mocked DTOs, in tests. */
final class TestShortcuts implements Rule {

    @Override
    public String id() {
        return "T7";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        if (!file.isTestClass()) {
            return List.of();
        }
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodInvocation node) {
                String name = node.getName().getIdentifier();
                String target = node.getExpression() == null ? "" : node.getExpression().toString();
                if (name.equals("setField") && target.endsWith("ReflectionTestUtils")) {
                    findings.add(file.finding(node, id(), "Don't set fields by reflection: pass the value through the constructor or a setter."));
                } else if (name.equals("mock") && !node.arguments().isEmpty()
                    && node.arguments().get(0) instanceof TypeLiteral literal
                    && literal.getType().toString().matches(".*Dto")) {
                    findings.add(file.finding(node, id(), "Don't mock `" + literal.getType() + "`: build a real DTO."));
                }
                return true;
            }
        });
        return findings;
    }

}
