package demo.marked;

import java.util.List;
import org.jspecify.annotations.Nullable;

class Good {

    private @Nullable String nickname;

    private java.util.@Nullable List<String> tags;

    private String @Nullable [] aliases;

    @Nullable String nickname() {
        return nickname;
    }

    String name(List<String> names) {
        Runnable task = () -> {
            return;
        };
        java.util.function.Supplier<@Nullable String> supplier = () -> null;
        return names.get(0);
    }

}
