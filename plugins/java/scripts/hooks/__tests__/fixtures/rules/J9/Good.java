package demo;

abstract class Good {

    private static final int LIMIT = 3;

    private final String name;

    Good(String name) {
        this.name = name;
    }

    public final String name() {
        return helper();
    }

    protected abstract void map();

    private String helper() {
        return name + LIMIT;
    }

    static class Nested {

        private int value;

        public int value() {
            return value;
        }

    }

}
