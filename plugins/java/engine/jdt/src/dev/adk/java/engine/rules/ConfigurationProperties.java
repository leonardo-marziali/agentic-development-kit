package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.SingleMemberAnnotation;
import org.eclipse.jdt.core.dom.StringLiteral;

/*
 * S4: configuration is bound with @ConfigurationProperties records, not
 * Spring's @Value("${…}"). Lombok's @Value is a marker annotation without a
 * property placeholder, so it never matches.
 */
final class ConfigurationProperties implements Rule {

    @Override
    public String id() {
        return "S4";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(SingleMemberAnnotation node) {
                if (Ast.isAnnotation(node, "Value") && node.getValue() instanceof StringLiteral literal
                    && literal.getLiteralValue().contains("${")) {
                    findings.add(file.finding(node, id(), "Bind `" + literal.getLiteralValue()
                        + "` through a `@ConfigurationProperties` record injected by constructor, not `@Value`."));
                }
                return true;
            }
        });
        return findings;
    }

}
