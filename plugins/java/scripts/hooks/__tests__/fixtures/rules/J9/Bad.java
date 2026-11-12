package demo;

class Bad {

    private final String name;

    Bad(String name) {
        this.name = name;
    }

    private void helper() {
    }

    public void run() { // expect: J9
    }

    private static final int LIMIT = 3; // expect: J9

}
