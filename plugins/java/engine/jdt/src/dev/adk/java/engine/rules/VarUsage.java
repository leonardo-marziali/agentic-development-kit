package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.ArrayCreation;
import org.eclipse.jdt.core.dom.BooleanLiteral;
import org.eclipse.jdt.core.dom.CharacterLiteral;
import org.eclipse.jdt.core.dom.ClassInstanceCreation;
import org.eclipse.jdt.core.dom.Expression;
import org.eclipse.jdt.core.dom.NumberLiteral;
import org.eclipse.jdt.core.dom.StringLiteral;
import org.eclipse.jdt.core.dom.TextBlock;
import org.eclipse.jdt.core.dom.VariableDeclarationFragment;
import org.eclipse.jdt.core.dom.VariableDeclarationStatement;

/* J13: `var` only when the right-hand side names the type (a constructor call or a literal). From Java 10. */
final class VarUsage implements Rule {

    @Override
    public String id() {
        return "J13";
    }

    @Override
    public int minJava() {
        return 10;
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(VariableDeclarationStatement node) {
                if (!node.getType().isVar()) {
                    return true;
                }
                for (Object item : node.fragments()) {
                    VariableDeclarationFragment fragment = (VariableDeclarationFragment) item;
                    Expression initializer = fragment.getInitializer();
                    if (initializer != null && !namesItsType(initializer)) {
                        findings.add(file.finding(node, id(), "Write the type of `" + fragment.getName()
                            + "`: `var` is only for a constructor call or a literal, where the type is visible."));
                    }
                }
                return true;
            }
        });
        return findings;
    }

    private static boolean namesItsType(Expression expression) {
        return expression instanceof ClassInstanceCreation || expression instanceof ArrayCreation
            || expression instanceof StringLiteral || expression instanceof TextBlock || expression instanceof NumberLiteral
            || expression instanceof CharacterLiteral || expression instanceof BooleanLiteral;
    }

}
