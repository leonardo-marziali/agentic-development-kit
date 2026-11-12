package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.MethodDeclaration;
import org.eclipse.jdt.core.dom.RecordDeclaration;

/*
 * J26: more than seven parameters become one parameter object built with a
 * fluent builder, ideally also offered as a `Consumer<…Builder>` overload.
 * An `@Override` can't change the signature it inherits, and a record's
 * canonical constructor mirrors its components, so both are left alone.
 */
final class LongParameterLists implements Rule {

    private static final int MAX_PARAMETERS = 7;

    @Override
    public String id() {
        return "J26";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodDeclaration node) {
                int count = node.parameters().size();
                if (count <= MAX_PARAMETERS || Ast.hasAnnotation(node, "Override")
                    || node.isConstructor() && node.getParent() instanceof RecordDeclaration) {
                    return true;
                }
                String message = node.isConstructor()
                    ? "This constructor takes " + count + " parameters: build the object with a builder (a step builder for"
                        + " mandatory values, D4), or split the class if they are injected dependencies."
                    : "`" + node.getName().getIdentifier() + "` takes " + count + " parameters: take one parameter object"
                        + " built with a fluent builder instead, ideally also as a `Consumer<…Builder>` overload.";
                findings.add(new Finding(file.line(node.getName()), id(), message));
                return true;
            }
        });
        return findings;
    }

}
