package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.MemberValuePair;
import org.eclipse.jdt.core.dom.MethodDeclaration;
import org.eclipse.jdt.core.dom.Modifier;
import org.eclipse.jdt.core.dom.NormalAnnotation;
import org.eclipse.jdt.core.dom.StringLiteral;
import org.eclipse.jdt.core.dom.TypeDeclaration;

/*
 * S21: no `expression = "java(...)"` in @Mapping (the compiler and refactoring
 * tools see only a string), and no private helpers in a @Mapper class
 * (MapStruct silently ignores them and may fall back to a built-in conversion).
 */
final class MapperStyle implements Rule {

    @Override
    public String id() {
        return "S21";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(NormalAnnotation node) {
                if (Ast.isAnnotation(node, "Mapping")) {
                    for (Object item : node.values()) {
                        MemberValuePair pair = (MemberValuePair) item;
                        String member = pair.getName().getIdentifier();
                        if ((member.equals("expression") || member.equals("defaultExpression"))
                            && pair.getValue() instanceof StringLiteral literal && literal.getLiteralValue().startsWith("java(")) {
                            findings.add(file.finding(node, id(), "Replace `" + member
                                + " = \"java(...)\"` with a small `protected` method MapStruct selects by type (`@Named` if ambiguous)."));
                        }
                    }
                }
                return true;
            }

            @Override
            public boolean visit(TypeDeclaration node) {
                if (Ast.hasAnnotation(node, "Mapper")) {
                    for (MethodDeclaration method : node.getMethods()) {
                        int modifiers = method.getModifiers();
                        if (Modifier.isPrivate(modifiers) && !Modifier.isStatic(modifiers)) {
                            findings.add(new Finding(file.line(method.getName()), id(), "Make `" + method.getName()
                                + "` protected: MapStruct ignores private helpers and may fall back to a built-in conversion."));
                        }
                    }
                }
                return true;
            }
        });
        return findings;
    }

}
