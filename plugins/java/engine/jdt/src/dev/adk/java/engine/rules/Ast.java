package dev.adk.java.engine.rules;

import java.util.List;
import org.eclipse.jdt.core.dom.ASTNode;
import org.eclipse.jdt.core.dom.Annotation;
import org.eclipse.jdt.core.dom.BodyDeclaration;
import org.eclipse.jdt.core.dom.IExtendedModifier;
import org.eclipse.jdt.core.dom.Name;
import org.eclipse.jdt.core.dom.SingleVariableDeclaration;

/* Name-based helpers: the engine parses without bindings. */
final class Ast {

    private Ast() {
    }

    // "Autowired" for both @Autowired and @org.springframework...Autowired.
    static String simpleName(Name name) {
        String full = name.getFullyQualifiedName();
        return full.substring(full.lastIndexOf('.') + 1);
    }

    static boolean isAnnotation(Annotation annotation, String simpleName) {
        return simpleName(annotation.getTypeName()).equals(simpleName);
    }

    static Annotation annotation(List<?> modifiers, String simpleName) {
        for (Object modifier : modifiers) {
            if (modifier instanceof Annotation annotation && isAnnotation(annotation, simpleName)) {
                return annotation;
            }
        }
        return null;
    }

    static Annotation annotation(BodyDeclaration declaration, String simpleName) {
        return annotation(declaration.modifiers(), simpleName);
    }

    static Annotation annotation(SingleVariableDeclaration parameter, String simpleName) {
        return annotation(parameter.modifiers(), simpleName);
    }

    static boolean hasAnnotation(BodyDeclaration declaration, String simpleName) {
        return annotation(declaration, simpleName) != null;
    }

    static boolean isModifier(Object modifier) {
        return modifier instanceof IExtendedModifier;
    }

    static String text(String source, ASTNode node) {
        return source.substring(node.getStartPosition(), node.getStartPosition() + node.getLength());
    }

}
