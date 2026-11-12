package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.eclipse.jdt.core.dom.ASTNode;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.Annotation;
import org.eclipse.jdt.core.dom.StringLiteral;
import org.eclipse.jdt.core.dom.TextBlock;

/*
 * S60: a URL in production code belongs in a `.properties` file, bound through
 * `@ConfigurationProperties`. Test code (WireMock bases) and annotation values
 * (OpenAPI links and examples) are left alone, and so are the XML and JSON
 * Schema namespaces, which are identifiers rather than endpoints.
 */
final class OutboundUrls implements Rule {

    private static final Pattern URL = Pattern.compile("^\\s*https?://.*", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private static final Pattern NAMESPACE = Pattern.compile(
        "^\\s*https?://(www\\.)?(w3\\.org|json-schema\\.org|schemas\\.xmlsoap\\.org|purl\\.org|xmlns\\.jcp\\.org"
            + "|java\\.sun\\.com|jakarta\\.ee)(/.*)?$",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    @Override
    public String id() {
        return "S60";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        if (file.inTestSources()) {
            return findings;
        }
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(StringLiteral node) {
                inspect(node, node.getLiteralValue());
                return false;
            }

            @Override
            public boolean visit(TextBlock node) {
                inspect(node, node.getLiteralValue());
                return false;
            }

            private void inspect(ASTNode node, String value) {
                if (URL.matcher(value).matches() && !NAMESPACE.matcher(value).matches() && !inAnnotation(node)) {
                    findings.add(file.finding(node, id(), "Move this URL to a `.properties` file (for example "
                        + "`paypal.api.protocol`, `paypal.api.host`, `paypal.api.version`) and bind it with "
                        + "`@ConfigurationProperties`."));
                }
            }
        });
        return findings;
    }

    private static boolean inAnnotation(ASTNode node) {
        for (ASTNode parent = node.getParent(); parent != null; parent = parent.getParent()) {
            if (parent instanceof Annotation) {
                return true;
            }
        }
        return false;
    }

}
