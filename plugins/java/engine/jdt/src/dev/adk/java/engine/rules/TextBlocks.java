package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTNode;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.Expression;
import org.eclipse.jdt.core.dom.InfixExpression;
import org.eclipse.jdt.core.dom.StringLiteral;

/* J14: multi-line text built from `"…\n" + "…"` across lines is a text block. From Java 15. */
final class TextBlocks implements Rule {

    @Override
    public String id() {
        return "J14";
    }

    @Override
    public int minJava() {
        return 15;
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(InfixExpression node) {
                if (node.getOperator() != InfixExpression.Operator.PLUS || node.getParent() instanceof InfixExpression) {
                    return true;
                }
                List<Expression> operands = new ArrayList<>();
                operands.add(node.getLeftOperand());
                operands.add(node.getRightOperand());
                for (Object extended : node.extendedOperands()) {
                    operands.add((Expression) extended);
                }
                long lines = operands.stream()
                    .filter(o -> o instanceof StringLiteral s && s.getEscapedValue().contains("\\n"))
                    .count();
                if (lines >= 2 && file.lineOfOffset(end(node)) > file.line(node)) {
                    findings.add(file.finding(node, id(), "Write this multi-line text as a text block (\"\"\"), not concatenated lines."));
                }
                return false;
            }
        });
        return findings;
    }

    private static int end(ASTNode node) {
        return node.getStartPosition() + node.getLength();
    }

}
