package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.MethodInvocation;

/* S2: loggers come from Lombok's @Slf4j, not a hand-written LoggerFactory field. */
final class Slf4jLogger implements Rule {

    @Override
    public String id() {
        return "S2";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodInvocation node) {
                if (node.getName().getIdentifier().equals("getLogger") && node.getExpression() != null
                    && node.getExpression().toString().endsWith("LoggerFactory")) {
                    findings.add(file.finding(node, id(), "Declare the logger with Lombok's `@Slf4j` instead of `LoggerFactory.getLogger`."));
                }
                return true;
            }
        });
        return findings;
    }

}
