package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.FieldDeclaration;
import org.eclipse.jdt.core.dom.ParameterizedType;
import org.eclipse.jdt.core.dom.SingleVariableDeclaration;
import org.eclipse.jdt.core.dom.Type;

/* J20: `Optional` is only a return type — never a field or a parameter. */
final class OptionalReturnOnly implements Rule {

    @Override
    public String id() {
        return "J20";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(FieldDeclaration node) {
                if (isOptional(node.getType())) {
                    findings.add(file.finding(node, id(), "Don't store an `Optional` in a field: use a `@Nullable` field and return `Optional` from the getter."));
                }
                return true;
            }

            @Override
            public boolean visit(SingleVariableDeclaration node) {
                if (isOptional(node.getType()) && node.getParent() instanceof org.eclipse.jdt.core.dom.MethodDeclaration) {
                    findings.add(file.finding(node, id(), "Don't take an `Optional` parameter: overload the method or accept a `@Nullable` value."));
                }
                return true;
            }
        });
        return findings;
    }

    private static boolean isOptional(Type type) {
        Type raw = type instanceof ParameterizedType parameterized ? parameterized.getType() : type;
        String name = raw.toString();
        return name.equals("Optional") || name.equals("java.util.Optional");
    }

}
