package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTNode;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.MethodInvocation;

/*
 * S42: never copy an exception message into a ProblemDetail's detail; it
 * leaks internals. From Spring Boot 3, where ProblemDetail exists.
 */
final class ProblemDetails implements Rule {

    @Override
    public String id() {
        return "S42";
    }

    @Override
    public int minBoot() {
        return 300;
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodInvocation node) {
                if (!node.getName().getIdentifier().equals("getMessage") || !node.arguments().isEmpty()) {
                    return true;
                }
                for (ASTNode parent = node.getParent(); parent != null; parent = parent.getParent()) {
                    if (parent instanceof MethodInvocation call && isDetailSink(call)) {
                        findings.add(file.finding(node, id(), "Write the `detail` for the client; never pass `getMessage()` from an exception into the response."));
                        break;
                    }
                }
                return true;
            }
        });
        return findings;
    }

    private static boolean isDetailSink(MethodInvocation call) {
        String name = call.getName().getIdentifier();
        String target = call.getExpression() == null ? "" : call.getExpression().toString();
        return name.equals("setDetail") || (name.equals("forStatusAndDetail") && target.endsWith("ProblemDetail"));
    }

}
