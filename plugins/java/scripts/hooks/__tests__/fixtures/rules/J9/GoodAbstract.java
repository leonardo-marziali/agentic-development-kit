package demo;

abstract class GoodAbstract {

    protected abstract String source();

    public final String name() {
        return source() + helper();
    }

    protected abstract String target();

    private String helper() {
        return target();
    }

}
