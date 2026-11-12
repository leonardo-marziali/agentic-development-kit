package demo;

import static java.util.Objects.requireNonNull;

import java.util.ArrayList;
import java.util.List;

class Good {
    List<String> names = new ArrayList<>(requireNonNull(List.of()));
}
