package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.Annotation;
import org.eclipse.jdt.core.dom.MarkerAnnotation;
import org.eclipse.jdt.core.dom.NormalAnnotation;
import org.eclipse.jdt.core.dom.SingleMemberAnnotation;

/* S3: constructor injection through @RequiredArgsConstructor; never @Autowired. */
final class ConstructorInjection implements Rule {

    @Override
    public String id() {
        return "S3";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(MarkerAnnotation node) {
                inspect(node);
                return true;
            }

            @Override
            public boolean visit(NormalAnnotation node) {
                inspect(node);
                return true;
            }

            @Override
            public boolean visit(SingleMemberAnnotation node) {
                inspect(node);
                return true;
            }

            private void inspect(Annotation annotation) {
                if (Ast.isAnnotation(annotation, "Autowired")) {
                    findings.add(file.finding(annotation, id(),
                        "Inject through the constructor (`private final` fields + `@RequiredArgsConstructor`), not `@Autowired`."));
                }
            }
        });
        return findings;
    }

}
