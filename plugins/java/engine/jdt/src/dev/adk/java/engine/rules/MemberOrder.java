package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.AbstractTypeDeclaration;
import org.eclipse.jdt.core.dom.BodyDeclaration;
import org.eclipse.jdt.core.dom.EnumDeclaration;
import org.eclipse.jdt.core.dom.FieldDeclaration;
import org.eclipse.jdt.core.dom.MethodDeclaration;
import org.eclipse.jdt.core.dom.Modifier;
import org.eclipse.jdt.core.dom.RecordDeclaration;
import org.eclipse.jdt.core.dom.TypeDeclaration;

/*
 * J9: constants, fields, constructors, public methods, other methods, nested
 * types — in that order, in every type. Initializers, annotation members and
 * `protected abstract` methods (a mapper's proxies, a template method's hooks)
 * have no slot and are skipped. The finding goes on each member that comes
 * after one of a later kind.
 */
final class MemberOrder implements Rule {

    private static final String[] KINDS = {"constants", "fields", "constructors", "public methods",
        "non-public methods", "nested types"};

    @Override
    public String id() {
        return "J9";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(TypeDeclaration node) {
                inspect(node);
                return true;
            }

            @Override
            public boolean visit(EnumDeclaration node) {
                inspect(node);
                return true;
            }

            @Override
            public boolean visit(RecordDeclaration node) {
                inspect(node);
                return true;
            }

            private void inspect(AbstractTypeDeclaration type) {
                int highest = -1;
                for (Object item : type.bodyDeclarations()) {
                    BodyDeclaration member = (BodyDeclaration) item;
                    int kind = kind(member, type);
                    if (kind < 0) {
                        continue;
                    }
                    if (kind < highest) {
                        findings.add(file.finding(member, id(), "Move these " + KINDS[kind] + " above the "
                            + KINDS[highest] + ": members go constants, fields, constructors, public methods, other methods, nested types."));
                    }
                    highest = Math.max(highest, kind);
                }
            }
        });
        return findings;
    }

    private static int kind(BodyDeclaration member, AbstractTypeDeclaration owner) {
        int modifiers = member.getModifiers();
        if (member instanceof FieldDeclaration) {
            return Modifier.isStatic(modifiers) && Modifier.isFinal(modifiers) ? 0 : 1;
        }
        if (member instanceof MethodDeclaration method) {
            if (method.isConstructor()) {
                return 2;
            }
            if (Modifier.isProtected(modifiers) && Modifier.isAbstract(modifiers)) {
                return -1;
            }
            boolean interfaceMember = owner instanceof TypeDeclaration t && t.isInterface();
            return Modifier.isPublic(modifiers) || (interfaceMember && !Modifier.isPrivate(modifiers)) ? 3 : 4;
        }
        if (member instanceof AbstractTypeDeclaration) {
            return 5;
        }
        return -1;
    }

}
