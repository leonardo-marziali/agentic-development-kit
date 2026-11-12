package com.acme.v2;

import lombok.Getter;
import org.jspecify.annotations.Nullable;

@Getter
class Project {

    private final String name = "n";

    private @Nullable String note;

    int nameLength() {
        return getName().length();
    }

    int noteLength() {
        return getNote().length(); // expect: J20
    }

    String nothing() {
        return null; // expect: J20
    }

}
