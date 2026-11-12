package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTNode;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.Annotation;
import org.eclipse.jdt.core.dom.AnnotatableType;
import org.eclipse.jdt.core.dom.ArrayType;
import org.eclipse.jdt.core.dom.FieldDeclaration;
import org.eclipse.jdt.core.dom.ImportDeclaration;
import org.eclipse.jdt.core.dom.LambdaExpression;
import org.eclipse.jdt.core.dom.MethodDeclaration;
import org.eclipse.jdt.core.dom.NullLiteral;
import org.eclipse.jdt.core.dom.ParameterizedType;
import org.eclipse.jdt.core.dom.PrimitiveType;
import org.eclipse.jdt.core.dom.ReturnStatement;
import org.eclipse.jdt.core.dom.SimpleType;
import org.eclipse.jdt.core.dom.SingleVariableDeclaration;
import org.eclipse.jdt.core.dom.Type;

/*
 * J20, the annotation half (NullAway does the flow analysis): nullness is
 * declared with one library, non-null is the package default, `null` is only
 * returned from @Nullable methods, and JSpecify's type-use @Nullable sits
 * where it means what the author meant.
 *
 * The --nullness mode picks the library: `jspecify`, `spring` (Boot 3.x's
 * org.springframework.lang), `auto` (whichever each file uses), or `off`
 * (the project disabled nullness checking; these rules don't run).
 */
final class Nullness implements Rule {

    private static final String JSPECIFY = "org.jspecify.annotations.";

    private static final List<String> SPRING = List.of("org.springframework.lang.Nullable",
        "org.springframework.lang.NonNull", "org.springframework.lang.NonNullApi", "org.springframework.lang.NonNullFields");

    private static final List<String> FOREIGN = List.of("lombok.NonNull", "javax.annotation.Nullable",
        "javax.annotation.Nonnull", "javax.annotation.CheckForNull", "javax.annotation.ParametersAreNonnullByDefault",
        "jakarta.annotation.Nullable", "jakarta.annotation.Nonnull", "org.jetbrains.annotations.Nullable",
        "org.jetbrains.annotations.NotNull", "edu.umd.cs.findbugs.annotations.", "androidx.annotation.Nullable",
        "androidx.annotation.NonNull", "org.checkerframework.checker.nullness.qual.");

    @Override
    public String id() {
        return "J20";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        String mode = file.nullness();
        if (mode.equals("off") || file.path().getFileName().toString().equals("package-info.java")) {
            return List.of();
        }
        List<Finding> findings = new ArrayList<>();
        String library = library(file, mode);
        checkImports(file, mode, findings);
        if (!file.inTestSources()) {
            checkPackageDefault(file, library, findings);
        }
        checkReturnNull(file, findings);
        if (library.equals("jspecify")) {
            checkTypeUsePlacement(file, findings);
        }
        return findings;
    }

    // In auto mode each file is held to the library it imports (JSpecify when it imports both).
    private static String library(SourceFile file, String mode) {
        if (!mode.equals("auto")) {
            return mode;
        }
        boolean spring = imports(file).stream().anyMatch(SPRING::contains);
        boolean jspecify = imports(file).stream().anyMatch(name -> name.startsWith(JSPECIFY));
        return spring && !jspecify ? "spring" : jspecify ? "jspecify" : "auto";
    }

    private static List<String> imports(SourceFile file) {
        List<String> names = new ArrayList<>();
        for (Object item : file.ast().imports()) {
            names.add(((ImportDeclaration) item).getName().getFullyQualifiedName());
        }
        return names;
    }

    private void checkImports(SourceFile file, String mode, List<Finding> findings) {
        boolean seenJspecify = false;
        boolean seenSpring = false;
        for (Object item : file.ast().imports()) {
            ImportDeclaration declaration = (ImportDeclaration) item;
            String name = declaration.getName().getFullyQualifiedName();
            boolean isJspecify = name.startsWith(JSPECIFY);
            boolean isSpring = SPRING.contains(name);
            if (FOREIGN.stream().anyMatch(name::startsWith)) {
                findings.add(file.finding(declaration, id(), "Declare nullness with " + libraryName(mode)
                    + ", not `" + name + "`: runtime checks and other libraries don't give the compile-time guarantee."));
            } else if ((isSpring && mode.equals("jspecify")) || (isJspecify && mode.equals("spring"))
                || (mode.equals("auto") && ((isSpring && seenJspecify) || (isJspecify && seenSpring)))) {
                findings.add(file.finding(declaration, id(), "Use one nullness library per project ("
                    + libraryName(mode.equals("auto") ? (seenJspecify ? "jspecify" : "spring") : mode) + "): drop `" + name + "`."));
            }
            seenJspecify |= isJspecify;
            seenSpring |= isSpring;
        }
    }

    private static String libraryName(String mode) {
        return switch (mode) {
            case "jspecify" -> "JSpecify (`org.jspecify.annotations`)";
            case "spring" -> "Spring's `org.springframework.lang` annotations";
            default -> "JSpecify or Spring's annotations";
        };
    }

    private void checkPackageDefault(SourceFile file, String library, List<Finding> findings) {
        if (file.ast().getPackage() == null) {
            return;
        }
        Path packageInfo = file.path().toAbsolutePath().getParent().resolve("package-info.java");
        String text;
        try {
            text = Files.exists(packageInfo) ? Files.readString(packageInfo, StandardCharsets.UTF_8) : "";
        } catch (IOException exception) {
            text = "";
        }
        boolean jspecify = text.contains("@NullMarked");
        boolean spring = text.contains("@NonNullApi") && text.contains("@NonNullFields");
        boolean ok = switch (library) {
            case "jspecify" -> jspecify;
            case "spring" -> spring;
            default -> jspecify || spring;
        };
        if (!ok) {
            String expected = library.equals("spring") ? "`@NonNullApi` and `@NonNullFields`" : "`@NullMarked`";
            findings.add(file.finding(file.ast().getPackage(), id(), "Package `" + file.ast().getPackage().getName()
                + "` needs a package-info.java with " + expected + " so non-null is the default."));
        }
    }

    private void checkReturnNull(SourceFile file, List<Finding> findings) {
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(ReturnStatement node) {
                if (!(node.getExpression() instanceof NullLiteral)) {
                    return true;
                }
                MethodDeclaration method = enclosingMethod(node);
                if (method != null && !returnsNullable(method)) {
                    findings.add(file.finding(node, id(), "`" + method.getName()
                        + "` returns null: annotate its return type `@Nullable` (or return a value / `Optional`)."));
                }
                return true;
            }
        });
    }

    // The method a return belongs to, or null when a lambda sits in between.
    private static MethodDeclaration enclosingMethod(ASTNode node) {
        for (ASTNode parent = node.getParent(); parent != null; parent = parent.getParent()) {
            if (parent instanceof LambdaExpression) {
                return null;
            }
            if (parent instanceof MethodDeclaration method) {
                return method;
            }
        }
        return null;
    }

    private static boolean returnsNullable(MethodDeclaration method) {
        return Ast.annotation(method, "Nullable") != null || hasTypeAnnotation(method.getReturnType2(), "Nullable");
    }

    private static boolean hasTypeAnnotation(Type type, String name) {
        Type annotated = type instanceof ParameterizedType parameterized ? parameterized.getType() : type;
        if (annotated instanceof AnnotatableType annotatable) {
            for (Object item : annotatable.annotations()) {
                if (Ast.isAnnotation((Annotation) item, name)) {
                    return true;
                }
            }
        }
        return false;
    }

    /*
     * JSpecify's @Nullable is a type-use annotation: in declaration position
     * it attaches to the outermost simple type, so `@Nullable java.util.List`
     * doesn't compile and `@Nullable String[]` marks the elements, not the
     * array.
     */
    private void checkTypeUsePlacement(SourceFile file, List<Finding> findings) {
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(FieldDeclaration node) {
                inspect(node.modifiers(), node.getType(), node);
                return true;
            }

            @Override
            public boolean visit(SingleVariableDeclaration node) {
                inspect(node.modifiers(), node.getType(), node);
                return true;
            }

            @Override
            public boolean visit(MethodDeclaration node) {
                if (node.getReturnType2() != null) {
                    inspect(node.modifiers(), node.getReturnType2(), node);
                }
                return true;
            }

            private void inspect(List<?> modifiers, Type type, ASTNode node) {
                if (Ast.annotation(modifiers, "Nullable") == null || type instanceof PrimitiveType) {
                    return;
                }
                if (type instanceof ArrayType) {
                    findings.add(file.finding(node, id(), "`@Nullable String[]` makes the elements nullable: write `String @Nullable []` for a nullable array."));
                } else if (qualified(type)) {
                    findings.add(file.finding(node, id(), "Put JSpecify's `@Nullable` right before the simple name: `java.util.@Nullable List`."));
                }
            }
        });
    }

    private static boolean qualified(Type type) {
        Type base = type instanceof ParameterizedType parameterized ? parameterized.getType() : type;
        return base instanceof SimpleType simple && simple.getName().isQualifiedName();
    }

}
