package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ImportDeclaration;

/* J16: no wildcard imports, static ones included. */
final class WildcardImports implements Rule {

    @Override
    public String id() {
        return "J16";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        for (Object item : file.ast().imports()) {
            ImportDeclaration declaration = (ImportDeclaration) item;
            if (declaration.isOnDemand()) {
                findings.add(file.finding(declaration, id(), "Wildcard import `"
                    + (declaration.isStatic() ? "static " : "") + declaration.getName().getFullyQualifiedName()
                    + ".*`: import each type or member explicitly."));
            }
        }
        return findings;
    }

}
